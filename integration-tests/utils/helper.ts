import {
  MnemonicKey,
  BCS,
  Msg,
  MsgFinalizeTokenWithdrawal,
  Coin
} from 'initia-l1'

import { config } from '../../src/config'
import { sha3_256 } from '../../src/lib/util'
import { ExecutorOutputEntity } from '../../src/orm/index'
import WithdrawalTxEntity from '../../src/orm/executor/WithdrawalTxEntity'
import { TxWalletL1 } from '../../src/lib/walletL1'

export const bcs = BCS.getInstance()
export const executorL1 = new TxWalletL1(
  config.l1lcd,
  new MnemonicKey({ mnemonic: config.EXECUTOR_MNEMONIC })
)
export const challengerL1 = new TxWalletL1(
  config.l1lcd,
  new MnemonicKey({ mnemonic: config.CHALLENGER_MNEMONIC })
)
export const outputSubmitterL1 = new TxWalletL1(
  config.l1lcd,
  new MnemonicKey({ mnemonic: config.OUTPUT_SUBMITTER_MNEMONIC })
)

export async function makeFinalizeMsg(
  txRes: WithdrawalTxEntity,
  outputRes: ExecutorOutputEntity
): Promise<Msg> {
  const msg = new MsgFinalizeTokenWithdrawal(
    config.BRIDGE_ID,
    outputRes.outputIndex,
    txRes.merkleProof,
    txRes.sender,
    txRes.receiver,
    parseInt(txRes.sequence),
    new Coin('uinit', txRes.amount),
    sha3_256(outputRes.outputIndex).toString('base64'),
    outputRes.stateRoot,
    outputRes.outputRoot,
    outputRes.lastBlockHash
  )
  return msg
}
