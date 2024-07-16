import { ExecutorWithdrawalTxEntity } from '../../orm'
import { getDB } from '../../worker/bridgeExecutor/db'

export interface GetWithdrawalTxListParam {
  sequence?: number;
  address?: string;
  offset?: number;
  limit: number;
  descending: string;
}

export interface GetWithdrawalTxListResponse {
  count?: number;
  next?: number;
  limit: number;
  withdrawalTxList: ExecutorWithdrawalTxEntity[];
}

export async function getWithdrawalTxList(
  param: GetWithdrawalTxListParam
): Promise<GetWithdrawalTxListResponse> {
  const [db] = getDB()
  const offset = param.offset ?? 0
  const order = param.descending ? 'DESC' : 'ASC'
  const limit = Number(param.limit) ?? 20

  const withdrawalRepo = db.getRepository(ExecutorWithdrawalTxEntity)
  const withdrawalWhereCond = {}

  if (param.sequence) {
    withdrawalWhereCond['sequence'] = param.sequence
  }

  if (param.address) {
    withdrawalWhereCond['receiver'] = param.address
  }

  const withdrawalTxList = await withdrawalRepo.find({
    where: withdrawalWhereCond,
    order: {
      sequence: order
    },
    skip: offset * limit,
    take: limit
  })

  const count = withdrawalTxList.length

  let next: number | undefined

  if (count > (offset + 1) * param.limit) {
    next = offset + 1
  }

  return {
    count,
    next,
    limit: param.limit,
    withdrawalTxList
  }
}
