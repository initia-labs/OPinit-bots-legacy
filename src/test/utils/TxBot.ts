import {
  MsgInitiateTokenDeposit,
  Coin,
} from 'initia-l1'
import { 
  MsgInitiateTokenWithdrawal
} from 'initia-l2'
import { makeFinalizeMsg } from './helper'
import { sendTx } from '../../lib/tx'
import {
  getOutputFromExecutor,
  getWithdrawalTxFromExecutor
} from '../../lib/query'
import { L1_SENDER, L2_RECEIVER } from './consts'

export class TxBot {
  l1sender = L1_SENDER
  l2receiver = L2_RECEIVER

  constructor(public bridgeId: number) {}

  async deposit(sender: any, reciever: any, coin: Coin) {
    const msg = new MsgInitiateTokenDeposit(
      sender.key.accAddress,
      this.bridgeId,
      reciever.key.accAddress,
      coin
    )

    return await sendTx(sender, [msg])
  }

  async withdrawal(sender: any, receiver: any, coin: Coin) {
    const msg = new MsgInitiateTokenWithdrawal(
      sender.key.accAddress,
      receiver.key.accAddress,
      coin
    )

    return await sendTx(sender, [msg])
  }

  async claim(sender: any, txSequence: number, outputIndex: number) {
    const txRes = await getWithdrawalTxFromExecutor(this.bridgeId, txSequence)
    const outputRes: any = await getOutputFromExecutor(outputIndex)
    const finalizeMsg = await makeFinalizeMsg(
      txRes.withdrawalTx,
      outputRes.output
    )

    const { account_number: accountNumber, sequence } =
      await sender.accountNumberAndSequence()
    
    return await sendTx(
      sender,
      [finalizeMsg],
      undefined,
      accountNumber,
      sequence
    )
  }
}
