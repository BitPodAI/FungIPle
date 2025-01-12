import express from "express";
import { DirectClient } from "./index";
import { Scraper } from "agent-twitter-client";
import { generateText, ModelClass, stringToUuid } from "@ai16z/eliza";
import { Memory, settings } from "@ai16z/eliza";
import { AgentConfig } from "../../../agent/src";
import {
    QUOTES_LIST,
    STYLE_LIST,
    TW_KOL_1,
    UserManager,
    InferMessageProvider,
    tokenWatcherConversationTemplate,
} from "@ai16z/plugin-data-enrich";
import { TwitterApi } from "twitter-api-v2";

import { callSolanaAgentTransfer } from "./solanaagentkit";

import { InvalidPublicKeyError } from "./solana";
import { Connection, clusterApiUrl } from "@solana/web3.js";
import { sendAndConfirmTransaction } from "@solana/web3.js";
import { createTokenTransferTransaction } from "./solana";
import { requireAuth } from "./auth";

interface TwitterCredentials {
    username: string;
    password: string;
    email: string;
}

interface ApiResponse<T = any> {
    status?: number;
    success: boolean;
    message: string;
    data?: T;
}

interface CreateAgentRequest {
    name?: string;
    userId?: string;
    roomId?: string;
    userName: string;
    prompt: string;
    x: {
        username: string;
        email: string;
        password: string;
    };
}

class ApiError extends Error {
    constructor(
        public status: number,
        message: string
    ) {
        super(message);
        this.name = "ApiError";
    }
}

class AuthUtils {
    constructor(private client: DirectClient) {}

    private createResponse<T>(data?: T, message = "Success"): ApiResponse<T> {
        return {
            success: true,
            message,
            data,
        };
    }

    private createErrorResponse(error: Error | ApiError): ApiResponse {
        const status = error instanceof ApiError ? error.status : 500;
        const message = error.message ?? "Internal server error";

        return {
            status,
            success: false,
            message,
        };
    }

    async withErrorHandling<T>(
        req: express.Request,
        res: express.Response,
        handler: () => Promise<T>
    ) {
        try {
            const result = await handler();
            return res.json(this.createResponse(result));
        } catch (error) {
            console.error(`Error in handler:`, error);
            const response = this.createErrorResponse(error);
            return res
                .status(error instanceof ApiError ? error.status : 500)
                .json(response);
        }
    }

    async verifyTwitterCredentials(
        credentials: TwitterCredentials
    ): Promise<any> {
        const scraper = new Scraper();
        try {
            await scraper.login(
                credentials.username,
                credentials.password,
                credentials.email
            );

            if (!(await scraper.isLoggedIn())) {
                throw new ApiError(401, "Twitter login failed");
            }

            const profile = await scraper.getProfile(credentials.username);
            return { ...profile };
        } finally {
            await scraper.logout();
        }
    }

    async getRuntime(agentId: string) {
        let runtime = this.client.agents.get(agentId);

        if (!runtime) {
            runtime = Array.from(this.client.agents.values()).find(
                (a) => a.character.name.toLowerCase() === agentId.toLowerCase()
            );
        }

        if (!runtime) {
            throw new ApiError(404, "Agent not found");
        }

        return runtime;
    }

    async validateRequest(agentId: string, userId: string) {
        if (!userId) {
            throw new ApiError(400, "Missing required field: userId");
        }

        const runtime = await this.getRuntime(agentId);
        const userManager = new UserManager(runtime.cacheManager);
        const userData = await userManager.verifyExistingUser(userId);

        return { runtime, ...userData };
    }

    async ensureUserConnection(
        runtime: any,
        userId: string,
        roomId: string,
        username: string
    ) {
        await runtime.ensureConnection(
            userId,
            roomId,
            username,
            username,
            "direct"
        );
    }
}

export class Routes {
    private authUtils: AuthUtils;

    constructor(
        private client: DirectClient,
        private registerCallbackFn?: (
            config: AgentConfig,
            memory: Memory
        ) => Promise<void>
    ) {
        this.authUtils = new AuthUtils(client);
    }

    setupRoutes(app: express.Application): void {
        app.post("/:agentId/login", this.handleLogin.bind(this));
        app.get(
            "/:agentId/twitter_oauth_init",
            this.handleTwitterOauthInit.bind(this)
        );
        app.get(
            "/:agentId/twitter_oauth_callback",
            this.handleTwitterOauthCallback.bind(this)
        );
        app.post(
            "/:agentId/twitter_profile_search",
            this.handleTwitterProfileSearch.bind(this)
        );
        app.post("/:agentId/profile_upd", this.handleProfileUpdate.bind(this));
        app.post(
            "/:agentId/profile",
            requireAuth,
            this.handleProfileQuery.bind(this)
        );
        app.post("/:agentId/create_agent", this.handleCreateAgent.bind(this));
        app.get("/:agentId/config", this.handleConfigQuery.bind(this));
        app.post("/:agentId/watch", this.handleWatchText.bind(this));
        app.post("/:agentId/chat", this.handleChat.bind(this));
        //app.post("/:agentId/transfer_sol", this.handleSolTransfer.bind(this));
        //app.post("/:agentId/solkit_transfer",
        //    this.handleSolAgentKitTransfer.bind(this));
    }

    async handleLogin(req: express.Request, res: express.Response) {
        return this.authUtils.withErrorHandling(req, res, async () => {
            const {
                userId,
                gmail,
                roomId: customRoomId,
                // userId: customUserId,
            } = req.body;

            if (!userId) {
                throw new ApiError(400, "Missing required fields");
            }

            const runtime = await this.authUtils.getRuntime(req.params.agentId);
            const roomId = stringToUuid(
                customRoomId ?? `default-room-${userId}-${req.params.agentId}`
            );

            await this.authUtils.ensureUserConnection(
                runtime,
                userId,
                roomId,
                "User"
            );

            const userProfile = UserManager.createDefaultProfile(userId, gmail);
            const userManager = new UserManager(runtime.cacheManager);
            await userManager.saveUserData(userProfile);

            return {
                profile: userProfile,
            };
        });
    }

    async handleTwitterOauthInit(req: express.Request, res: express.Response) {
        return this.authUtils.withErrorHandling(req, res, async () => {
            const client = new TwitterApi({
                clientId: settings.TWITTER_CLIENT_ID,
                clientSecret: settings.TWITTER_CLIENT_SECRET,
            });

            const { url, state, codeVerifier } = client.generateOAuth2AuthLink(
                `${settings.MY_APP_URL}/${req.params.agentId}/twitter_oauth_callback`,
                {
                    scope: [
                        "tweet.read",
                        "tweet.write",
                        "users.read",
                        "offline.access",
                    ],
                }
            );

            // Save state & codeVerifier
            const runtime = await this.authUtils.getRuntime(req.params.agentId);
            await runtime.cacheManager.set(
                "oauth_verifier",
                JSON.stringify({
                    codeVerifier,
                    state,
                    timestamp: Date.now(),
                }),
                {
                    expires: Date.now() + 2 * 60 * 60 * 1000,
                }
            );
            //await runtime.databaseAdapter?.setCache({
            //    agentId: state,
            //    key: 'oauth_verifier',
            //    value: JSON.stringify({
            //        codeVerifier,
            //        state,
            //        timestamp: Date.now()
            //    }),
            //    ttl: 3600 // 1hour
            //});

            return { url, state };
        });
    }

    async handleTwitterOauthCallback(
        req: express.Request,
        res: express.Response
    ) {
        //return this.authUtils.withErrorHandling(req, res, async () => {
        // 1. Get code and state
        const { code, state } = req.query;

        if (!code || !state) {
            res.status(200).json({ ok: true });
            return;
            //throw new ApiError(400, "Missing required OAuth parameters");
        }

        const runtime = await this.authUtils.getRuntime(req.params.agentId);

        const verifierData = await runtime.cacheManager.get("oauth_verifier");

        if (!verifierData) {
            // error
            console.error(
                `OAuth verification failed - State: ${state}, No verifier data found`
            );
            throw new ApiError(
                400,
                "OAuth session expired or invalid. Please try authenticating again."
            );
        }

        const { codeVerifier, timestamp } = JSON.parse(verifierData);

        try {
            const client = new TwitterApi({
                clientId: settings.TWITTER_CLIENT_ID,
                clientSecret: settings.TWITTER_CLIENT_SECRET,
            });

            const { accessToken, refreshToken, expiresIn } =
                await client.loginWithOAuth2({
                    code,
                    codeVerifier,
                    redirectUri: `${settings.MY_APP_URL}/${req.params.agentId}/twitter_oauth_callback`,
                });

            let username = "";
            let email = "";
            const me = await client.v2.me();
            console.log("me is", me);
            if (me?.data) {
                username = me.data.username;
                email = me.data.email;
            }

            // Clear
            await runtime.databaseAdapter?.deleteCache({
                agentId: state,
                key: "oauth_verifier",
            });

            // Save twitter profile
            // TODO: encrypt token
            //const userId = req.params.agentId;
            const userId = stringToUuid(username);
            const userManager = new UserManager(runtime.cacheManager);
            const userProfile = userManager.createDefaultProfile(userId);
            userProfile.tweetProfile = {
                username,
                email,
                avatar: "",
                code,
                codeVerifier,
                accessToken,
                refreshToken,
                expiresIn,
            };

            //await runtime.cacheManager.set("userProfile", JSON.stringify(userProfile), {
            //    expires: Date.now() + 2 * 60 * 60 * 1000,
            //});

            await userManager.saveUserData(userProfile);

            //return { accessToken };
            res.send(`
                    <!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>FungIPle</title>
                        <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTczIiBoZWlnaHQ9IjE2MyIgdmlld0JveD0iMCAwIDE3MyAxNjMiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik0wIDEwNi44OUgxOS4yMDM1TDE5LjIzMzYgNzcuNDYwOUgwLjAzMDA3NkwwIDEwNi44OVoiIGZpbGw9IiNGRjk5MDAiLz4KPHBhdGggZD0iTTE3Mi45NTIgMjkuNDI5NUwxNzIuOTY3IDE5LjcxNDlDMTcyLjk2NyA5LjUxOTA5IDE2My4yNjggMCAxNTIuODYyIDBIODMuNzkyMkg4MS43OTIxSDc0LjQzODZINzMuOTQyM1YwLjAxNTAzODFDNjAuMDQ3MiAwLjI0MDYwOSA1MC4wOTIxIDEwLjEzNTcgNTAuMDc3IDIzLjg1MDRMNTAuMDE2OSA3Ny40NjExSDI5LjU2NTJMMjkuNTM1MiAxMDYuODkxSDQ5Ljk4NjhMNDkuOTI2NyAxNjIuNjIySDgzLjY4NjlMODMuNzQ3MSAxMDYuODkxSDgzLjc3NzJIMTQ4LjUzMUMxNjIuNjgxIDEwNi44OTEgMTcyLjg3NyA5Ni45MDUzIDE3Mi44OTIgODMuMDQwMkwxNzIuOTM3IDQxLjQ2NzJIMTM5LjE3N0wxMzkuMTMyIDc3LjQ2MTFIODMuNzkyMlYyOS40Mjk1SDEzOS4xOTJIMTcyLjk1MloiIGZpbGw9IiNGRjk5MDAiLz4KPC9zdmc+Cg==">
                        <style>
                            body {
                                margin: 0;
                            }
                            .container {
                                display: flex;
                                justify-content: center;
                                align-items: center;
                                width: 100vw;
                            }
                            .ad_img {
                                max-width: 1000px;
                                width: 100%;
                                height: auto;
                            }
                            @media only screen and (max-width: 670px) {
                                .ad_img {
                                    max-width: 660px;
                                    width: 100%;
                                    height: auto;
                                }
                            }
                        </style>
                    </head>
                    <body>
                        <div style="text-align: center; font-size: 20px; font-weight: bold;">
                            <h1>FungIPle Agent</h1>
                            <br>Login Success!<br>
                            <script type="text/javascript">
                                console.log('window.opener');
                                console.log(window.opener);
                                function closeWindow() {
                                    console.log('closeWindow');
                                    try {
                                        window.opener.postMessage({
                                            type: 'TWITTER_AUTH_SUCCESS',
                                            code: '${code}',
                                            state: '${state}'
                                        },
                                        '*'
                                        );
                                        window.close();
                                    } catch(e) {
                                        console.log(e);
                                    }
                                }
                            </script>
                            <button style="text-align: center; width: 40%; height: 40px; font-size: 20px; background-color: #9F91ED; color: #ffffff; margin: 20px; border: none; border-radius: 10px;"
                                onclick="closeWindow()">
                                Click to Close</button>
                            <br>
                        </div>
                        <div class="container">
                            <img style="max-width: 40%; width: 40%; height: auto;" src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTczIiBoZWlnaHQ9IjE2MyIgdmlld0JveD0iMCAwIDE3MyAxNjMiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik0wIDEwNi44OUgxOS4yMDM1TDE5LjIzMzYgNzcuNDYwOUgwLjAzMDA3NkwwIDEwNi44OVoiIGZpbGw9IiNGRjk5MDAiLz4KPHBhdGggZD0iTTE3Mi45NTIgMjkuNDI5NUwxNzIuOTY3IDE5LjcxNDlDMTcyLjk2NyA5LjUxOTA5IDE2My4yNjggMCAxNTIuODYyIDBIODMuNzkyMkg4MS43OTIxSDc0LjQzODZINzMuOTQyM1YwLjAxNTAzODFDNjAuMDQ3MiAwLjI0MDYwOSA1MC4wOTIxIDEwLjEzNTcgNTAuMDc3IDIzLjg1MDRMNTAuMDE2OSA3Ny40NjExSDI5LjU2NTJMMjkuNTM1MiAxMDYuODkxSDQ5Ljk4NjhMNDkuOTI2NyAxNjIuNjIySDgzLjY4NjlMODMuNzQ3MSAxMDYuODkxSDgzLjc3NzJIMTQ4LjUzMUMxNjIuNjgxIDEwNi44OTEgMTcyLjg3NyA5Ni45MDUzIDE3Mi44OTIgODMuMDQwMkwxNzIuOTM3IDQxLjQ2NzJIMTM5LjE3N0wxMzkuMTMyIDc3LjQ2MTFIODMuNzkyMlYyOS40Mjk1SDEzOS4xOTJIMTcyLjk1MloiIGZpbGw9IiNGRjk5MDAiLz4KPC9zdmc+Cg==">
                        </div>

                        <div>
                            <br>
                        </div>

                    </body>
                </html>`);
        } catch (error) {
            console.error("Error during OAuth callback:", error);
            //throw new ApiError(500, "Internal server error");
            res.status(500).json({ error: "Internal server error" });
        }
        //});
    }

    async handleTwitterProfileSearch(
        req: express.Request,
        res: express.Response
    ) {
        return this.authUtils.withErrorHandling(req, res, async () => {
            const { username, count } = req.body;
            const fetchCount = Math.min(20, count);

            try {
                const profiles = [];
                const scraper = new Scraper();
                try {
                    await scraper.login(
                        settings.TWITTER_USERNAME,
                        settings.TWITTER_PASSWORD,
                        settings.TWITTER_EMAIL
                    );

                    if (!(await scraper.isLoggedIn())) {
                        throw new ApiError(401, "Twitter process failed");
                    }

                    const response = await scraper.searchProfiles(
                        username,
                        count
                    );
                    for await (const profile of response) {
                        profiles.push(profile);
                    }
                } finally {
                    await scraper.logout();
                }
                /*const promise = new Promise((resolve, reject) => {
                    // Listen
                    twEventCenter.on('MSG_SEARCH_TWITTER_PROFILE_RESP', (data) => {
                        console.log('Received Resp message:', data);
                        profiles = data;

                        // get result
                        resolve(profiles);
                    });

                    // set request
                    twEventCenter.emit('MSG_SEARCH_TWITTER_PROFILE', { username, count: fetchCount });
                    console.log("Send search request");
                });

                // wait for result
                const result = await promise;
                return { profiles: result };*/
                return profiles;
            } catch (error) {
                console.error("Profile search error:", error);
                return res.status(500).json({
                    success: false,
                    error: "User search error",
                });
            }
        });
    }

    async handleProfileUpdate(req: express.Request, res: express.Response) {
        try {
            const { profile } = req.body;

            // 验证必要字段
            if (!profile || !profile.userId || !profile.style) {
                return res.status(400).json({
                    success: false,
                    error: "Missing required profile fields",
                });
            }

            // 验证数组字段
            if (
                !Array.isArray(profile.bio) ||
                !Array.isArray(profile.topics) ||
                !Array.isArray(profile.messageExamples)
            ) {
                return res.status(400).json({
                    success: false,
                    error: "Invalid array fields in profile",
                });
            }

            // 验证嵌套对象
            if (
                !profile.style.all ||
                !profile.style.chat ||
                !profile.style.post ||
                !Array.isArray(profile.style.all) ||
                !Array.isArray(profile.style.chat) ||
                !Array.isArray(profile.style.post)
            ) {
                return res.status(400).json({
                    success: false,
                    error: "Invalid style configuration",
                });
            }

            // 更新profile
            const { runtime, profile: existingProfile } =
                await this.authUtils.validateRequest(
                    req.params.agentId,
                    req.body.userId
                );

            const updatedProfile = { ...existingProfile, ...profile };
            const userManager = new UserManager(runtime.cacheManager);
            await userManager.updateProfile(updatedProfile);

            return res.json({
                success: true,
                profile: updatedProfile,
            });
        } catch (error) {
            console.error("Profile update error:", error);
            return res.status(500).json({
                success: false,
                error: "Internal server error",
            });
        }
    }

    async handleProfileQuery(req: express.Request, res: express.Response) {
        try {
            const { profile } = await this.authUtils.validateRequest(
                req.params.agentId,
                req.body.userId
            );

            return res.json({
                success: true,
                profile,
            });
        } catch (error) {
            console.error("Profile query error:", error);
            return res.status(500).json({
                success: false,
                error: "Internal server error",
            });
        }
    }

    async handleCreateAgent(req: express.Request, res: express.Response) {
        return this.authUtils.withErrorHandling(req, res, async () => {
            const { userId } = req.body;

            if (!userId) {
                throw new ApiError(400, "Missing required field: userId");
            }

            // Get user profile and credentials
            const { runtime, profile } = await this.authUtils.validateRequest(
                req.params.agentId,
                userId
            );

            const {
                name = profile.username,
                roomId: customRoomId,
                prompt,
            } = req.body;

            // if (!prompt) {
            //     throw new ApiError(400, "Missing required field: prompt");
            // }

            const roomId = stringToUuid(
                customRoomId ??
                    `default-room-${profile.username}-${req.params.agentId}`
            );
            const newAgentId = stringToUuid(name);

            // Create agent config from user credentials
            const agentConfig: AgentConfig = {
                ...profile,
                prompt,
                name,
                clients: ["twitter"],
                modelProvider: "redpill",
                bio: Array.isArray(profile.bio)
                    ? profile.bio
                    : [profile.bio || `I am ${name}`],
                style: profile.style || {
                    all: [],
                    chat: [],
                    post: [],
                },
                adjectives: profile.adjectives || [],
                lore: profile.lore || [],
                knowledge: profile.knowledge || [],
                topics: profile.topics || [],
            };

            // Ensure connection
            await runtime.ensureConnection(
                userId,
                roomId,
                profile.username,
                name,
                "direct"
            );

            // Create memory
            const messageId = stringToUuid(Date.now().toString());
            const memory: Memory = {
                id: messageId,
                agentId: runtime.agentId,
                userId,
                roomId,
                content: {
                    text: prompt,
                    attachments: [],
                    source: "direct",
                    inReplyTo: undefined,
                },
                createdAt: Date.now(),
            };

            await runtime.messageManager.createMemory(memory);

            // Register callback if provided
            if (this.client.registerCallbackFn) {
                await this.client.registerCallbackFn(agentConfig, memory);
            }

            return { profile, agentId: newAgentId };
        });
    }

    async handleConfigQuery(req: express.Request, res: express.Response) {
        return this.authUtils.withErrorHandling(req, res, async () => {
            const quoteIndex = Math.floor(
                Math.random() * (QUOTES_LIST.length - 1)
            );
            return {
                styles: STYLE_LIST,
                kols: settings.TW_KOL_LIST || TW_KOL_1,
                quote: QUOTES_LIST[quoteIndex],
            };
        });
    }

    async handleWatchText(req: express.Request, res: express.Response) {
        return this.authUtils.withErrorHandling(req, res, async () => {
            const runtime = await this.authUtils.getRuntime(req.params.agentId);
            try {
                const { cursor } = req.body;
                const report =
                    await InferMessageProvider.getAllWatchItemsPaginated(
                        runtime.cacheManager,
                        cursor
                    );
                return { watchlist: report };
            } catch (error) {
                console.error("Error fetching token data:", error);
                return { report: "Watcher is in working, please wait." };
            }
        });
    }

    async handleChat(req: express.Request, res: express.Response) {
        return this.authUtils.withErrorHandling(req, res, async () => {
            const runtime = await this.authUtils.getRuntime(req.params.agentId);
            const prompt =
                `Your name is ${req.body.name || runtime.character.name},
                Here are user input content:
            ${req.body.text}` + tokenWatcherConversationTemplate;

            try {
                let response = await generateText({
                    runtime: runtime,
                    context: prompt,
                    modelClass: ModelClass.SMALL,
                });

                if (!response) {
                    throw new Error("No response from generateText");
                }
                response = response.replaceAll("```", "");
                response = response.replace("json", "");

                // TODO
                //

                return { response };
            } catch (error) {
                console.error("Error response token question:", error);
                return { response: "Response with error" };
            }
        });
    }

    /*async handleSolTransfer(req: express.Request, res: express.Response) {
        return this.authUtils.withErrorHandling(req, res, async () => {
            const {
                fromTokenAccountPubkey,
                toTokenAccountPubkey,
                ownerPubkey,
                tokenAmount,
            } = req.body;

    //         try {
    //             const transaction = await createTokenTransferTransaction({
    //                 fromTokenAccountPubkey,
    //                 toTokenAccountPubkey,
    //                 ownerPubkey,
    //                 tokenAmount,
    //             });

    //             // 发送并确认交易
    //             const connection = new Connection(
    //                 clusterApiUrl("mainnet-beta"),
    //                 "confirmed"
    //             );
    //             const signature = await sendAndConfirmTransaction(
    //                 connection,
    //                 transaction,
    //                 [ownerPubkey]
    //             );

    //             return { signature };
    //         } catch (error) {
    //             if (error instanceof InvalidPublicKeyError) {
    //                 throw new ApiError(400, error.message);
    //             }
    //             console.error(
    //                 "Error creating token transfer transaction:",
    //                 error
    //             );
    //             throw new ApiError(500, "Internal server error");
    //         }
    //     });
    // }

    async handleSolAgentKitTransfer(
        req: express.Request,
        res: express.Response
    ) {
        return this.authUtils.withErrorHandling(req, res, async () => {
            const {
                fromTokenAccountPubkey,
                toTokenAccountPubkey,
                ownerPubkey,
                tokenAmount,
            } = req.body;
            try {
                const transaction = await callSolanaAgentTransfer({
                    toTokenAccountPubkey,
                    mintPubkey: ownerPubkey,
                    tokenAmount,
                });
                return { transaction };
            } catch (error) {
                if (error instanceof InvalidPublicKeyError) {
                    throw new ApiError(400, error.message);
                }
                console.error("Error in SolAgentKit transfer:", error);
                throw new ApiError(500, "Internal server error");
            }
        });
    }*/
}
