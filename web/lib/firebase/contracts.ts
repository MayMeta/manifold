import { collection, onSnapshot, doc } from '@firebase/firestore'
import { db } from './init'

export type Contract = {
  id: string
  creatorId: string
  creatorName: string
  question: string
  description: string
}

const contractCollection = collection(db, 'contracts')

export function listenForContract(
  contractId: string,
  setContract: (contract: Contract) => void
) {
  const contractRef = doc(contractCollection, contractId)

  return onSnapshot(contractRef, (contractSnap) => {
    setContract(contractSnap.data() as Contract)
  })
}
