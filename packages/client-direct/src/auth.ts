import { PrivyClient } from "@privy-io/server-auth";
import { RequestHandler } from "express";
import { settings } from "@ai16z/eliza";

const privy = new PrivyClient(
    settings.PRIVY_APP_ID,
    settings.PRIVY_APP_SECRET
);

/**
 * Verify privy token
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
