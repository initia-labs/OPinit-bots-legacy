import { WithdrawStorage } from './storage'
import { sha3_256 } from './util'

const v1 = [
  {
    bridge_id: BigInt(1),
    sequence: BigInt(1),
    sender: 'init1wzenw7r2t2ra39k4l9yqq95pw55ap4sm4vsa9g',
    receiver: 'init174knscjg688ddtxj8smyjz073r3w5mmsp3m0m2',
    l1_denom: 'uinit',
    amount: BigInt(1000000)
  },
  {
    bridge_id: BigInt(1),
    sequence: BigInt(2),
    sender: 'init1wzenw7r2t2ra39k4l9yqq95pw55ap4sm4vsa9g',
    receiver: 'init174knscjg688ddtxj8smyjz073r3w5mmsp3m0m2',
    l1_denom: 'uinit',
    amount: BigInt(1000000)
  },
  {
    bridge_id: BigInt(1),
    sequence: BigInt(3),
    sender: 'init1wzenw7r2t2ra39k4l9yqq95pw55ap4sm4vsa9g',
    receiver: 'init174knscjg688ddtxj8smyjz073r3w5mmsp3m0m2',
    l1_denom: 'uinit',
    amount: BigInt(1000000)
  }
]

describe('WithdrawStorage', () => {
  it('verify v1', async () => {
    const airdrop = new WithdrawStorage(v1)
    const target = v1[0]

    const merkleRoot = airdrop.getMerkleRoot()
    const merkleProof = airdrop.getMerkleProof(target)
    const version = 2
    const stateRoot = 'C2ZdjJ7uX41NaadA/FjlMiG6btiDfYnxE2ABqJocHxI='
    const lastBlockHash = 'tgmfQJT4uipVToW631xz0RXdrfzu7n5XxGNoPpX6isI='
    const outputRoot = sha3_256(
      Buffer.concat([
        sha3_256(version),
        Buffer.from(stateRoot, 'base64'), // state root
        Buffer.from(merkleRoot, 'base64'),
        Buffer.from(lastBlockHash, 'base64') // block hash
      ])
    ).toString('base64')
    expect(airdrop.verify(merkleProof, target)).toBeTruthy()
  })
})
