import {
    clusterApiUrl,
    Connection,
    PublicKey,
    Transaction,
} from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    createTransferInstruction,
    getAssociatedTokenAddress
} from "@solana/spl-token";
import { settings } from "@ai16z/eliza";

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
 * Create Solana SPL Meme Coin Transacation
 * @param params Trans input
 * @returns Transaction Output
 */
export async function createSolSplTransferTransaction({
    fromTokenAccountPubkey,
    toTokenAccountPubkey,
    ownerPubkey,
    tokenAmount,
}: TransferTokenParams): Promise<Transaction> {
    try {
        const connection = new Connection(
            clusterApiUrl("mainnet-beta"),
            "confirmed"
        );
    
        // Check the address
        const fromTokenAccount = new PublicKey(fromTokenAccountPubkey);
        const toTokenAccount = new PublicKey(toTokenAccountPubkey);
        const owner = new PublicKey(ownerPubkey);
        const mint = new PublicKey(settings.SOL_SPL_MINT_PUBKEY);
    
        // Get the soure SPL SmartContract Address (if exist)
        const sourceTokenAccount = await getAssociatedTokenAddress(
            fromTokenAccount,
            mint,
            false
        );
    
        // Get the dest SPL SmartContract Address (if exist)
        const destinationTokenAccount = await getAssociatedTokenAddress(
            toTokenAccount,
            mint,
            false
        );
    
        // Create Trans
        const transaction = new Transaction();
    
        // Add SPL
        transaction.add(
            createTransferInstruction(
                sourceTokenAccount,
                destinationTokenAccount,
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
    } catch (err) {
        console.error(err);
        throw new Error("SPL Transaction Error.");
    }
}
