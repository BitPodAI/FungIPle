import {
    clusterApiUrl,
    Connection,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
} from "@solana/web3.js";

interface TransferSolParams {
    fromPubkey: PublicKey | string;
    toPubkey: PublicKey | string;
    solAmount: number;
}

export class InvalidPublicKeyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidPublicKeyError";
    }
}

/**
 * 创建 Solana SOL 转账交易
 * @param params 转账参数
 * @returns Transaction 对象
 */
export async function createSolTransferTransaction({
    fromPubkey,
    toPubkey,
    solAmount,
}: TransferSolParams): Promise<Transaction> {
    const connection = new Connection(
        clusterApiUrl("mainnet-beta"), // 或者 'mainnet-beta' 用于主网
        "confirmed"
    );

    // 验证并转换公钥
    let fromPublicKey: PublicKey;
    let toPublicKey: PublicKey;

    try {
        fromPublicKey =
            typeof fromPubkey === "string"
                ? new PublicKey(fromPubkey)
                : fromPubkey;
        toPublicKey =
            typeof toPubkey === "string" ? new PublicKey(toPubkey) : toPubkey;
    } catch (err) {
        throw new InvalidPublicKeyError("Invalid public key provided");
    }

    // 验证金额
    if (isNaN(solAmount) || solAmount <= 0) {
        throw new Error("Invalid SOL amount: must be a positive number");
    }

    // 创建交易
    const transaction = new Transaction();

    // 添加转账指令
    transaction.add(
        SystemProgram.transfer({
            fromPubkey: fromPublicKey,
            toPubkey: toPublicKey,
            lamports: BigInt(solAmount * LAMPORTS_PER_SOL),
        })
    );

    // 设置手续费支付账户
    transaction.feePayer = fromPublicKey;

    // 获取并设置最新区块哈希
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;

    return transaction;
}
