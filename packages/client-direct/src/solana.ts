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
 * 创建 ai16z Meme Coin 转账交易
 * @param params 转账参数
 * @returns Transaction 对象
 */
export async function createTokenTransferTransaction({
    fromTokenAccountPubkey,
    toTokenAccountPubkey,
    ownerPubkey,
    tokenAmount,
}: TransferTokenParams): Promise<Transaction> {
    const connection = new Connection(
        clusterApiUrl("mainnet-beta"),
        "confirmed"
    );

    // 验证并转换公钥
    const fromTokenAccount = new PublicKey(fromTokenAccountPubkey);
    const toTokenAccount = new PublicKey(toTokenAccountPubkey);
    const owner = new PublicKey(ownerPubkey);

    // 创建交易
    const transaction = new Transaction();

    // 添加代币转账指令
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

    // 设置手续费支付账户
    transaction.feePayer = owner;

    // 获取并设置最新区块哈希
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;

    return transaction;
}
