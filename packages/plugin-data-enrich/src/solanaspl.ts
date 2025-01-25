import {
    clusterApiUrl,
    Connection,
    PublicKey,
    Transaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createTransferInstruction } from "@solana/spl-token";

interface TransferTokenParams {
    fromTokenAccountPubkey: PublicKey | string;
    toTokenAccountPubkey: PublicKey | string;
    ownerPubkey: PublicKey | string;
    tokenAmount: number;
}

export class InvalidPublicKeyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidPublicKeyError";
    }
}

/**
 * Create ai16z Meme Coin Transacation
 * @param params Trans input
 * @returns Transaction Output
 */
export async function createSolSplTransferTransaction({
    fromTokenAccountPubkey,
    toTokenAccountPubkey,
    ownerPubkey,
    tokenAmount,
}: TransferTokenParams): Promise<Transaction> {
    const connection = new Connection(
        clusterApiUrl("mainnet-beta"),
        "confirmed"
    );

    // Check the address
    const fromTokenAccount = new PublicKey(fromTokenAccountPubkey);
    const toTokenAccount = new PublicKey(toTokenAccountPubkey);
    const owner = new PublicKey(ownerPubkey);

    // Create Trans
    const transaction = new Transaction();

    // Add SPL
    transaction.add(
        createTransferInstruction(
            fromTokenAccount,
            toTokenAccount,
            owner,
            tokenAmount,
            [],
            TOKEN_PROGRAM_ID
        )
    );

    // Set Gas Address
    transaction.feePayer = owner;

    // Get Result
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;

    return transaction;
}
