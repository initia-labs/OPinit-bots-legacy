import { KoaController } from 'koa-joi-controllers'
import { BatchController } from './batch/BatchController'
import { OutputController } from './executor/OutputController'
import { WithdrawalTxController } from './executor/WithdrawalTxController'
import { DepositTxController } from './executor/DepositTxController'
import { ClaimTxController } from './executor/ClaimTxController'
import { MetricsController } from './executor/MetricsController'

export const executorController = [
  OutputController,
  WithdrawalTxController,
  DepositTxController,
  ClaimTxController,
  MetricsController
].map((prototype) => new prototype()) as KoaController[]

export const batchController = [BatchController].map(
  (prototype) => new prototype()
) as KoaController[]
