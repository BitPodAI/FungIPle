import { PrivyClient } from "@privy-io/server-auth";
import { RequestHandler } from "express";
const privy = new PrivyClient(
    process.env.PRIVY_APP_ID,
    process.env.PRIVY_APP_SECRET
);
/**
 * 验证 privy token
 * @param token
 * @returns
 */
export async function verifyPrivyToken(token: string) {
    try {
        const verifiedClaims = await privy.verifyAuthToken(token);
        return verifiedClaims;
    } catch (error) {
        console.log(`Token verification failed with error ${error}.`);
    }
}

/**
 * express middleware to parse privy token from header
 * @param req
 * @param res
 * @param next
 */
export const parseToken = async (req, res, next) => {
    const token = req.headers.authorization;
    if (token) {
        res.locals.user = await verifyPrivyToken(token);
    }
    next();
};

/**
 * express middleware to require auth
 * @param req
 * @param res
 * @param next
 */
export const requireAuth: RequestHandler = (req, res, next) => {
    const user = res.locals.user;
    if (!user) {
        res.status(401).json({ error: "Token not provided" });
    } else {
        next();
    }
};
