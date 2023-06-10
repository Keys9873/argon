import {
  CompilingTask,
  JudgerTaskType,
  NewSubmission,
  SubmissionStatus,
  ContestSubmission,
  TestingSubmission,
  SubmissionType
} from '@argoncs/types'
import { rabbitMQ, mongoDB, judgerExchange, judgerTasksKey, fetchSubmission } from '@argoncs/common'
import { languageConfigs } from '../../configs/language.configs.js'

import { nanoid } from '../utils/nanoid.utils.js'

export async function createTestingSubmission (submission: NewSubmission, domainId: string, problemId: string, userId: string): Promise<{ submissionId: string }> {
  const submissionCollection = mongoDB.collection<TestingSubmission | ContestSubmission>('submissions')

  const submissionId = await nanoid()
  const pendingSubmission: TestingSubmission = {
    ...submission,
    id: submissionId,
    status: SubmissionStatus.Compiling,
    domainId,
    problemId,
    type: SubmissionType.Testing
  }

  await submissionCollection.insertOne(pendingSubmission)
  return { submissionId }
}

export async function queueSubmission (submissionId: string): Promise<void> {
  const submission = await fetchSubmission(submissionId)

  const task: CompilingTask = {
    submissionId: submission.id,
    type: JudgerTaskType.Compiling,
    source: submission.source,
    language: submission.language,
    constraints: languageConfigs[submission.language].constraints
  }
  rabbitMQ.publish(judgerExchange, judgerTasksKey, Buffer.from(JSON.stringify(task)))
}

export async function markSubmissionAsCompiling (submissionId: string): Promise<void> {
  const submissionCollection = mongoDB.collection<TestingSubmission | ContestSubmission>('submissions')

  await submissionCollection.updateOne({ id: submissionId }, {
    $set: {
      status: SubmissionStatus.Compiling
    }
  })
}
