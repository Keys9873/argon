import { fetchContestProblem, fetchDomainProblem, fetchSubmission, judgerExchange, judgerTasksKey, rabbitMQ, ranklistRedis, recalculateTeamTotalScore, submissionCollection, teamScoreCollection, domainProblemCollection } from '@argoncs/common'
import { type CompilingResult, CompilingStatus, type GradingResult, GradingStatus, type GradingTask, JudgerTaskType, type Problem, SubmissionStatus, type CompilingCheckerResult  } from '@argoncs/types' /*=*/
import { NotFoundError } from 'http-errors-enhanced'
import path from 'path'

export async function handleCompileResult (compileResult: CompilingResult, submissionId: string): Promise<void> {
  const submission = await fetchSubmission({ submissionId })

  if (submission.status === SubmissionStatus.Compiling) {
    if (compileResult.status === CompilingStatus.Succeeded) {
      const { problemId, domainId, contestId } = submission
      let problem: Problem = contestId == null ?
        await fetchDomainProblem({ problemId, domainId }) : 
        await fetchContestProblem({ problemId, contestId })

      if (problem.testcases == null) {
        await completeGrading(submissionId, 'Problem does not have testcases');
        return
      }

      if (problem.checker === null || problem.checker === undefined) {
        await completeGrading(submissionId, 'Problem Checker does not exist or is not compiled');
        return
      }

      const submissionTestcases: Array<{ points: number, input: { name: string, versionId: string }, output: { name: string, versionId: string } }> = []

      problem.testcases.forEach((testcase, index) => {
        const task: GradingTask = {
          constraints: problem.constraints,
          type: JudgerTaskType.Grading,
          submissionId,
          problemId: problem.id,
          testcase: {
            input: {
              objectName: path.join(problem.id, testcase.input.name),
              versionId: testcase.input.versionId
            },
            output: {
              objectName: path.join(problem.id, testcase.output.name),
              versionId: testcase.output.versionId
            }
          },
          checker: { 
            objectName: problem.checker!.name,
            versionId: problem.checker!.versionId 
          },
          testcaseIndex: index,
          language: submission.language
        }
        rabbitMQ.publish(judgerExchange, judgerTasksKey, Buffer.from(JSON.stringify(task)))
        submissionTestcases.push({ points: testcase.points, input: testcase.input, output: testcase.output })
      })

      await submissionCollection.updateOne({ id: submissionId }, {
        $set: {
          status: SubmissionStatus.Grading,
          gradedCases: 0,
          testcases: submissionTestcases
        }
      })
    } else {
      await submissionCollection.updateOne({ id: submissionId }, {
        $set: {
          status: SubmissionStatus.CompileFailed,
          log: compileResult.log
        }
      })
    }
  }
}

export async function completeGrading (submissionId: string, log?: string): Promise<void> {
  const submission = await fetchSubmission({ submissionId })

  if (submission.status !== SubmissionStatus.Compiling &&
      submission.status !== SubmissionStatus.Grading) {
    console.error('completeGrading recieved unexpected status: ', submission.status);
    return;
  }

  // Failed on Transition from Compiling to Grading or Grading Failed
  if (submission.status === SubmissionStatus.Compiling ||
      submission.gradedCases !== submission.testcases.length) {
    await submissionCollection.updateOne({ id: submissionId }, { $set: { status: SubmissionStatus.Terminated, log } })
    return;
  } 

  // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
  const score = submission.testcases.reduce((accumulator: number, testcase) => accumulator + (testcase.score ?? 0), 0)
  await submissionCollection.updateOne({ id: submissionId }, {
    $set: {
      score,
      status: SubmissionStatus.Graded
    },
    $unset: {
      gradedCases: ''
    }
  })

  // Skip score update if testing submission
  if (submission.contestId == null || submission.teamId == null) 
    return

  const { modifiedCount } = await teamScoreCollection.updateOne({ contestId: submission.contestId, id: submission.teamId }, {
    $max: { [`scores.${submission.problemId}`]: score }
  })

  // Only update if score increased 
  if (modifiedCount > 0) {
    await teamScoreCollection.updateOne({ contestId: submission.contestId, id: submission.teamId }, {
      $max: { [`time.${submission.problemId}`]: submission.createdAt }
    })
    const { contestId, teamId } = submission
    await recalculateTeamTotalScore({ contestId, teamId })
    await ranklistRedis.set(`${submission.contestId}-obsolete`, 1)
  }
}

export async function handleGradingResult (gradingResult: GradingResult, submissionId: string, testcaseIndex: number): Promise<void> {
  const submission = await fetchSubmission({ submissionId })

  if (submission.status === SubmissionStatus.Grading) {
    if (submission.testcases[testcaseIndex] == null) {
      throw new NotFoundError('No testcase found at the given index')
    }
    const score = gradingResult.status === GradingStatus.Accepted ? submission.testcases[testcaseIndex].points : 0
    submission.testcases[testcaseIndex].result = gradingResult
    await submissionCollection.updateOne({ id: submissionId }, {
      $set: {
        [`testcases.${testcaseIndex}.result`]: gradingResult,
        [`testcases.${testcaseIndex}.score`]: score
      },
      $inc: {
        gradedCases: 1,
        score
      }
    })

    const updatedSubmission = await fetchSubmission({ submissionId })
    if (updatedSubmission.status === SubmissionStatus.Grading) {
      if (updatedSubmission.gradedCases === updatedSubmission.testcases.length) {
        await completeGrading(submissionId)
      }
    }
  }
}

export async function handleCompileCheckerResult (result: CompilingCheckerResult, problemId: string): Promise<void> {

  if (result.status == CompilingStatus.Failed) {
    // TODO: warn of broken checker
    console.log('checker compilation failed')
    return
  }

  const checker = result.checker;
  console.log('checker compilation result recieved: ', checker);
  await domainProblemCollection.updateOne({ id: problemId }, { $set: { checker }});
}
