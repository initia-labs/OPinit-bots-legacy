export async function sendTx(
  wallet: any,
  msgs: any[],
  fee?: any,
  accountNumber?: number,
  sequence?: number,
  timeout = 10_000
): Promise<any> {
  const signedTx = await wallet.createAndSignTx({
    msgs,
    fee,
    accountNumber,
    sequence
  })
  
  const broadcastResult = await wallet.lcd.tx.broadcast(signedTx, timeout)
  if (broadcastResult['code']) throw new Error(broadcastResult.raw_log)
  return broadcastResult
}

export async function sendRawTx(
  wallet: any,
  txBytes: string,
  timeout = 10_000
): Promise<any> {
  const broadcastResult = await wallet.lcd.tx.broadcast(txBytes, timeout)
  if (broadcastResult['code']) throw new Error(broadcastResult.raw_log)
  return broadcastResult
}

// check whether batch submission interval is met
export async function getLatestBlockHeight(client: any): Promise<number> {
  const block = await client.tendermint.blockInfo().catch((error) => {
    throw new Error(`Error getting block info from L2: ${error}`)
  })

  return parseInt(block.block.header.height)
}
