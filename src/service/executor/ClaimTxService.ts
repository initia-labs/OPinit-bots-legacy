import { ExecutorWithdrawalTxEntity, ExecutorOutputEntity } from '../../orm'
import { getDB } from '../../worker/bridgeExecutor/db'
import { APIError, ErrorTypes } from '../../lib/error'
import { sha3_256 } from '../../lib/util'

interface ClaimTx {
  bridgeId: number;
  outputIndex: number;
  merkleProof: string[];
  sender: string;
  receiver: string;
  amount: number;
  l2Denom: string;
  version: string;
  stateRoot: string;
  merkleRoot: string;
  lastBlockHash: string;
}

export interface GetClaimTxListParam {
  sequence?: number;
  address?: string;
  stage?: number;
  offset?: number;
  limit: number;
  descending: string;
}

export interface GetClaimTxListResponse {
  count?: number;
  next?: number;
  limit: number;
  claimTxList: ClaimTx[];
}

export async function getClaimTxList(
  param: GetClaimTxListParam
): Promise<GetClaimTxListResponse> {
  const [db] = getDB()

  const offset = param.offset ?? 0
  const order = param.descending ? 'DESC' : 'ASC'
  const limit = Number(param.limit) ?? 20

  const claimTxList: ClaimTx[] = []

  const withdrawalRepo = db.getRepository(ExecutorWithdrawalTxEntity)
  const withdrawalWhereCond = {}

  if (param.address) {
    withdrawalWhereCond['receiver'] = param.address
  }

  if (param.sequence) {
    withdrawalWhereCond['sequence'] = param.sequence
  }

  const withdrawalTxs = await withdrawalRepo.find({
    where: withdrawalWhereCond,
    order: {
      sequence: order
    },
    skip: offset * limit,
    take: limit
  })

  withdrawalTxs.map(async (withdrawalTx) => {
    const output = await db.getRepository(ExecutorOutputEntity).findOne({
      where: { outputIndex: withdrawalTx.outputIndex }
    })

    if (!output) {
      throw new APIError(ErrorTypes.NOT_FOUND_ERROR)
    }

    const claimData: ClaimTx = {
      bridgeId: parseInt(withdrawalTx.bridgeId),
      outputIndex: withdrawalTx.outputIndex,
      merkleProof: withdrawalTx.merkleProof,
      sender: withdrawalTx.sender,
      receiver: withdrawalTx.receiver,
      amount: parseInt(withdrawalTx.amount),
      l2Denom: withdrawalTx.l2Denom,
      version: sha3_256(withdrawalTx.outputIndex).toString('base64'),
      stateRoot: output.stateRoot,
      merkleRoot: output.merkleRoot,
      lastBlockHash: output.lastBlockHash
    }
    claimTxList.push(claimData)
  })

  const count = withdrawalTxs.length

  let next: number | undefined

  if (count > (offset + 1) * limit) {
    next = offset + 1
  }

  return {
    count,
    next,
    limit,
    claimTxList
  }
}
