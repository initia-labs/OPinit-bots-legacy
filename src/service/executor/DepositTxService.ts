import { ExecutorDepositTxEntity } from '../../orm'
import { getDB } from '../../worker/bridgeExecutor/db'

export interface GetDepositTxListParam {
  sequence?: number;
  address?: string;
  offset?: number;
  limit: number;
  descending: string;
}

export interface GetDepositTxListResponse {
  count?: number;
  next?: number;
  limit: number;
  depositTxList: ExecutorDepositTxEntity[];
}

export async function getDepositTxList(
  param: GetDepositTxListParam
): Promise<GetDepositTxListResponse> {
  const [db] = getDB()
  const offset = param.offset ?? 0
  const order = param.descending ? 'DESC' : 'ASC'
  const limit = Number(param.limit) ?? 20

  const depositTxRepo = db.getRepository(ExecutorDepositTxEntity)
  const depositTxWhereCond = {}

  if (param.sequence) {
    depositTxWhereCond['sequence'] = param.sequence
  }

  if (param.address) {
    depositTxWhereCond['sender'] = param.address
  }

  const depositTxList = await depositTxRepo.find({
    where: depositTxWhereCond,
    order: {
      sequence: order
    },
    skip: offset * limit,
    take: limit
  })

  const count = depositTxList.length

  let next: number | undefined

  if (count > (offset + 1) * limit) {
    next = offset + 1
  }

  return {
    count,
    next,
    limit,
    depositTxList
  }
}
