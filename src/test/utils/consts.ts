import { MnemonicKey as MnemonicKeyL1 } from 'initia-l1'
import { MnemonicKey as MnemonicKeyL2 } from 'initia-l2'
import { config } from '../../config'
import { TxWalletL1 } from '../../lib/walletL1'
import { TxWalletL2 } from '../../lib/walletL2'

export const { DEPOSITOR_MNEMONIC } = process.env

export const L1_SENDER = new TxWalletL1(
  config.l1lcd,
  new MnemonicKeyL1({
    mnemonic: DEPOSITOR_MNEMONIC
  })
)

export const L2_RECEIVER = new TxWalletL2(
  config.l2lcd,
  new MnemonicKeyL2({
    mnemonic: DEPOSITOR_MNEMONIC
  })
)
