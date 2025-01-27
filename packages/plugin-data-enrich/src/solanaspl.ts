import {
    clusterApiUrl,
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    sendAndConfirmTransaction
} from "@solana/web3.js";
import bs58 from "bs58";
import {
    TOKEN_MINT,
    getAccount,
    TOKEN_PROGRAM_ID,
    createTransferInstruction,
    getAssociatedTokenAddress,
    getOrCreateAssociatedTokenAccount,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccount
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
}: TransferTokenParams): Promise<string> {
    try {
        const connection = new Connection(
            clusterApiUrl("mainnet-beta"),
            "confirmed"
        );

        const privateKeyString = settings.SOL_SPL_OWNER_PRIVKEY;
        const secretKey = bs58.decode(privateKeyString);
        const senderKeypair = Keypair.fromSecretKey(secretKey);

        // Check the address
        const fromTokenAccount = new PublicKey(fromTokenAccountPubkey);
        const toTokenAccount = new PublicKey(toTokenAccountPubkey);
        const owner = new PublicKey(senderKeypair.publicKey);
        const mint = new PublicKey(settings.SOL_SPL_MINT_PUBKEY);
        let mintAccount = await connection.getAccountInfo(mint);
        const mintAddressStr = mintAccount.data.slice(0, 32);
        const mintAddress = new PublicKey(mintAddressStr);
        console.log("Mint Address:", mintAddress.toString());
        console.log(TOKEN_PROGRAM_ID);

        // Get the soure SPL SmartContract Address (if exist)
        /*const sourceTokenAccount = await getAssociatedTokenAddress(
            ASSOCIATED_TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            mint,
            senderKeypair.publicKey
        );
        
        const destinationTokenAccount = await getAssociatedTokenAddress(
            ASSOCIATED_TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            mint,
            toTokenAccount
        );*/
        /*const sourceTokenAccount = await getAssociatedTokenAddress(
            mint,
            senderKeypair.publicKey,
            false
        );*/
        try {
            const accountInfo = await getAccount(connection, senderKeypair.publicKey);
            console.log('Token Account Info:', accountInfo);
        } catch (error) {
            console.error(error);
        }
        const sourceTokenAccount = await getOrCreateAssociatedTokenAccount(
            connection,
            senderKeypair,
            mint,
            senderKeypair.publicKey
        );
        console.log(sourceTokenAccount);
        let fromTokenAccountInfo = await connection.getAccountInfo(sourceTokenAccount);
        console.log(fromTokenAccountInfo);
        if (!fromTokenAccountInfo) {
            // create
            await createAssociatedTokenAccount(
              connection,
              senderKeypair,
              mint,
              owner
            );
        }

        const testTokenAccount = await getAssociatedTokenAddress(
            fromTokenAccount,
            mint,
            false
        );
        let accountTest = await connection.getAccountInfo(testTokenAccount);
        console.log(accountTest);

        // Get the dest SPL SmartContract Address (if exist)
        const destinationTokenAccount = await getAssociatedTokenAddress(
            mint,
            toTokenAccount,
            false
        );
        console.log(destinationTokenAccount);
        let accountDest = await connection.getAccountInfo(destinationTokenAccount);
        console.log(accountDest);

        //const sourceBalance = await connection.getTokenAccountBalance(sourceTokenAccount);
        //console.log(sourceBalance);

        // Create Trans
        const transaction = new Transaction();

        // Add SPL
        transaction.add(
            createTransferInstruction(
                senderKeypair.publicKey,
                toTokenAccount,
                senderKeypair,
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
        transaction.sign(senderKeypair);
        console.log(transaction);
        const serializedTransaction = transaction.serialize();
        console.log(serializedTransaction);

        const signature = await sendAndConfirmTransaction(connection, transaction,
            [senderKeypair]);
        console.log(signature);

        //const signature = await connection.sendRawTransaction(serializedTransaction);
        //await connection.confirmTransaction(signature);

        return signature;
    } catch (err) {
        console.error(err);
        throw new Error("SPL Transaction Error.");
    }
}
