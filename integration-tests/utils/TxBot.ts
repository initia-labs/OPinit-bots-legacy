import { MsgInitiateTokenDeposit, Coin } from 'initia-l1'
import { MsgInitiateTokenWithdrawal } from 'initia-l2'
import { makeFinalizeMsg } from './helper'
import {
  getOutputFromExecutor,
  getWithdrawalTxFromExecutor
} from '../../src/lib/query'
import { L1_SENDER, L2_RECEIVER } from './consts'
import { TxWalletL1 } from '../../src/lib/walletL1'
import { TxWalletL2 } from '../../src/lib/walletL2'

export class TxBot {
  l1sender = L1_SENDER
  l2receiver = L2_RECEIVER

  constructor(public bridgeId: number) {}

  async deposit(sender: TxWalletL1, reciever: TxWalletL2, coin: Coin) {
    const msg = new MsgInitiateTokenDeposit(
      sender.key.accAddress,
      this.bridgeId,
      reciever.key.accAddress,
      coin
    )

    return await sender.transaction([msg])
  }

  async withdrawal(sender: TxWalletL2, receiver: TxWalletL1, coin: Coin) {
    const msg = new MsgInitiateTokenWithdrawal(
      sender.key.accAddress,
      receiver.key.accAddress,
      coin
    )

    return await sender.transaction([msg])
  }

  async claim(sender: TxWalletL1, txSequence: number, outputIndex: number) {
    const txRes = await getWithdrawalTxFromExecutor(this.bridgeId, txSequence)
    const outputRes: any = await getOutputFromExecutor(outputIndex)
    const finalizeMsg = await makeFinalizeMsg(
      txRes.withdrawalTx,
      outputRes.output
    )

    return await sender.transaction([finalizeMsg])
  }
}
