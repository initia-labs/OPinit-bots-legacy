import {
  Key,
  Wallet,
  Msg,
  MnemonicKey,
  LCDClient,
  WaitTxBroadcastResult,
  Coins
} from 'initia-l1'
import { sendTx } from './tx'
import { config } from '../config'
import {
  buildNotEnoughBalanceNotification,
  buildResolveErrorNotification,
  notifySlack
} from './slack'

export enum WalletType {
  Challenger = 'challenger',
  Executor = 'executor',
  BatchSubmitter = 'batchSubmitter',
  OutputSubmitter = 'outputSubmitter'
}

export const wallets: {
  challenger: TxWalletL1 | undefined;
  executor: TxWalletL1 | undefined;
  batchSubmitter: TxWalletL1 | undefined;
  outputSubmitter: TxWalletL1 | undefined;
} = {
  challenger: undefined,
  executor: undefined,
  batchSubmitter: undefined,
  outputSubmitter: undefined
}

export function initWallet(type: WalletType, lcd: LCDClient): void {
  if (wallets[type]) return

  switch (type) {
    case WalletType.Challenger:
      wallets[type] = new TxWalletL1(
        lcd,
        new MnemonicKey({ mnemonic: config.CHALLENGER_MNEMONIC })
      )
      break
    case WalletType.Executor:
      wallets[type] = new TxWalletL1(
        lcd,
        new MnemonicKey({ mnemonic: config.EXECUTOR_MNEMONIC })
      )
      break
    case WalletType.BatchSubmitter:
      wallets[type] = new TxWalletL1(
        lcd,
        new MnemonicKey({ mnemonic: config.BATCH_SUBMITTER_MNEMONIC })
      )
      break
    case WalletType.OutputSubmitter:
      wallets[type] = new TxWalletL1(
        lcd,
        new MnemonicKey({ mnemonic: config.OUTPUT_SUBMITTER_MNEMONIC })
      )
      break
  }
}

// Access the wallets
export function getWallet(type: WalletType): TxWalletL1 {
  if (!wallets[type]) {
    throw new Error(`Wallet ${type} not initialized`)
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return wallets[type]!
}

export class TxWalletL1 extends Wallet {
  private managedAccountNumber
  private managedSequence

  constructor(lcd: LCDClient, key: Key) {
    super(lcd, key)
  }

  async checkEnoughBalance() {
    const gasPrices = new Coins(this.lcd.config.gasPrices)
    const denom = gasPrices.denoms()[0]

    const balance = await this.lcd.bank.balanceByDenom(
      this.key.accAddress,
      denom
    )

    const key = `${this.key.accAddress}-${balance.amount}`
    if (
      balance.amount &&
      parseInt(balance.amount) < config.SLACK_NOT_ENOUGH_BALANCE_THRESHOLD
    ) {
      await notifySlack(
        key,
        buildNotEnoughBalanceNotification(this, parseInt(balance.amount), denom)
      )
    } else {
      await notifySlack(
        key,
        buildResolveErrorNotification(
          `Balance for ${this.key.accAddress} is restored.`
        ),
        false
      )
    }
  }

  async transaction(msgs: Msg[]): Promise<WaitTxBroadcastResult> {
    if (!this.managedAccountNumber && !this.managedSequence) {
      const { account_number: accountNumber, sequence } =
        await this.accountNumberAndSequence()
      this.managedAccountNumber = accountNumber
      this.managedSequence = sequence
    }

    try {
      await this.checkEnoughBalance()
      const txInfo = await sendTx(
        this,
        msgs,
        undefined,
        this.managedAccountNumber,
        this.managedSequence
      )
      this.managedSequence += 1
      return txInfo
    } catch (err) {
      delete this.managedAccountNumber
      delete this.managedSequence
      throw err
    }
  }
}
