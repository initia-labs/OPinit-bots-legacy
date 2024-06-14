import { ExecutorOutputEntity } from '../../orm'
import { getDB } from '../../worker/bridgeExecutor/db'

export interface GetOutputListParam {
  output_index?: number;
  height?: number;
  offset?: number;
  limit: number;
  descending: boolean;
}

export interface GetOutputListResponse {
  count?: number;
  next?: number;
  limit: number;
  outputList: ExecutorOutputEntity[];
}

export async function getOutputList(
  param: GetOutputListParam
): Promise<GetOutputListResponse> {
  const [db] = getDB()
  const offset = param.offset ?? 0
  const order = param.descending ? 'DESC' : 'ASC'
  const limit = Number(param.limit) ?? 20

  const outputRepo = db.getRepository(ExecutorOutputEntity)
  const outputWhereCond = {}

  if (param.output_index) {
    outputWhereCond['outputIndex'] = param.output_index
  }

  const outputList = await outputRepo.find({
    where: outputWhereCond,
    order: {
      outputIndex: order
    },
    skip: offset * limit,
    take: limit
  })

  const count = outputList.length
  let next: number | undefined

  if (count > (offset + 1) * limit) {
    next = offset + 1
  }

  return {
    count,
    next,
    limit,
    outputList
  }
}
