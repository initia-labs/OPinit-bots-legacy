export enum BatchErrorTypes {
  EBLOCK_BULK = 'Error getting block bulk from L2',
  ERAW_COMMIT = 'Error getting commit from L2',
  EUNKNOWN_TARGET = `unknown batch target`,
  EPUBLIC_KEY_NOT_SET = 'batch submitter public key not set',
  EGAS_PRICES_NOT_SET = 'gasPrices must be set',
  EMAX_RETRIES = 'max retries exceeded'
}

export class BatchError extends Error {
  public type: string
  public message: string
  public wrappedError?: Error

  constructor(type: BatchErrorTypes, message = '', err?: Error) {
    super(message)
    this.name = 'BatchError'
    this.type = type || BatchErrorTypes.EBLOCK_BULK
    this.message = message
    this.wrappedError = err
  }
}
