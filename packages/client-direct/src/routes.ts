import express from "express";
import { DirectClient } from "./index";
import { Scraper } from "agent-twitter-client";
import { stringToUuid } from "@ai16z/eliza";
import { Memory } from "@ai16z/eliza";
import { AgentConfig } from "../../../agent/src";

interface TwitterCredentials {
    username: string;
    password: string;
    email: string;
}

interface TwitterProfile {
    followersCount: number;
    verified: boolean;
}

interface UserProfile {
    username: string;
    email: string;
    avatar?: string;
    bio?: string;
    walletAddress?: string;
    level: number;
    experience: number;
    nextLevelExp: number;
    points: number;
    tweetFrequency: {
        dailyLimit: number;
        currentCount: number;
        lastTweetTime?: number;
    };
    stats: {
        totalTweets: number;
        successfulTweets: number;
        failedTweets: number;
    };
}

interface ApiResponse<T = any> {
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
        const message =
            error instanceof ApiError ? error.message : "Internal server error";

        return {
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

    async verifyExistingUser(
        runtime: any,
        userId: string
    ): Promise<{ config: any; profile: UserProfile }> {
        const [configStr, profileStr] = await Promise.all([
            runtime.databaseAdapter?.getCache({
                agentId: userId,
                key: "xConfig",
            }),
            runtime.databaseAdapter?.getCache({
                agentId: userId,
                key: "userProfile",
            }),
        ]);

        if (!configStr || !profileStr) {
            throw new ApiError(404, "User not found");
        }

        const config = JSON.parse(configStr);
        const profile = JSON.parse(profileStr);

        // Verify Twitter credentials
        await this.verifyTwitterCredentials({
            username: config.username,
            email: config.email,
            password: config.password,
        });

        return { config, profile };
    }

    async validateRequest(agentId: string, userId: string) {
        if (!userId) {
            throw new ApiError(400, "Missing required field: userId");
        }

        const runtime = await this.getRuntime(agentId);
        const userData = await this.verifyExistingUser(runtime, userId);

        return { runtime, ...userData };
    }

    async saveUserData(
        userId: string,
        runtime: any,
        credentials: TwitterCredentials,
        profile: UserProfile
    ) {
        const config = {
            username: credentials.username,
            email: credentials.email,
            password: credentials.password,
        };

        await Promise.all([
            runtime.databaseAdapter?.setCache({
                agentId: userId,
                key: "xConfig",
                value: JSON.stringify(config),
            }),
            runtime.databaseAdapter?.setCache({
                agentId: userId,
                key: "userProfile",
                value: JSON.stringify(profile),
            }),
        ]);
    }

    createDefaultProfile(username: string, email: string): UserProfile {
        return {
            username,
            email,
            level: 1,
            experience: 0,
            nextLevelExp: 1000,
            points: 0,
            tweetFrequency: {
                dailyLimit: 10,
                currentCount: 0,
                lastTweetTime: Date.now(),
            },
            stats: {
                totalTweets: 0,
                successfulTweets: 0,
                failedTweets: 0,
            },
        };
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
        app.post("/:agentId/profile_upd", this.handleProfileUpdate.bind(this));
        app.post("/:agentId/profile", this.handleProfileQuery.bind(this));
        app.post("/:agentId/create_agent", this.handleCreateAgent.bind(this));
    }

    async handleLogin(req: express.Request, res: express.Response) {
        return this.authUtils.withErrorHandling(req, res, async () => {
            const {
                username,
                email,
                password,
                roomId: customRoomId,
                userId: customUserId,
            } = req.body;

            if (!username || !email || !password) {
                throw new ApiError(400, "Missing required fields");
            }

            const runtime = await this.authUtils.getRuntime(req.params.agentId);
            const twitterProfile =
                await this.authUtils.verifyTwitterCredentials({
                    username,
                    password,
                    email,
                });

            const userId = stringToUuid(customUserId ?? username);
            const roomId = stringToUuid(
                customRoomId ?? `default-room-${username}-${req.params.agentId}`
            );

            await this.authUtils.ensureUserConnection(
                runtime,
                userId,
                roomId,
                username
            );

            const userProfile = this.authUtils.createDefaultProfile(
                username,
                email
            );
            await this.authUtils.saveUserData(
                userId,
                runtime,
                { username, email, password },
                userProfile
            );

            return {
                profile: userProfile,
                twitterProfile,
            };
        });
    }

    async handleProfileUpdate(req: express.Request, res: express.Response) {
        return this.authUtils.withErrorHandling(req, res, async () => {
            const { userId, profile: updateFields } = req.body;
            const { runtime, profile: existingProfile } =
                await this.authUtils.validateRequest(
                    req.params.agentId,
                    userId
                );

            const updatedProfile = { ...existingProfile, ...updateFields };
            await runtime.databaseAdapter?.setCache({
                agentId: userId,
                key: "userProfile",
                value: JSON.stringify(updatedProfile),
            });

            return { profile: updatedProfile };
        });
    }

    async handleProfileQuery(req: express.Request, res: express.Response) {
        return this.authUtils.withErrorHandling(req, res, async () => {
            const { userId } = req.body;
            const { profile } = await this.authUtils.validateRequest(
                req.params.agentId,
                userId
            );

            return { profile };
        });
    }

    async handleCreateAgent(req: express.Request, res: express.Response) {
        return this.authUtils.withErrorHandling(req, res, async () => {
            const { userId } = req.body;

            if (!userId) {
                throw new ApiError(400, "Missing required field: userId");
            }

            // Get user profile and credentials
            const {
                runtime,
                config: credentials,
                profile,
            } = await this.authUtils.validateRequest(
                req.params.agentId,
                userId
            );

            const {
                name = profile.username,
                roomId: customRoomId,
                prompt,
            } = req.body;

            if (!prompt) {
                throw new ApiError(400, "Missing required field: prompt");
            }

            const roomId = stringToUuid(
                customRoomId ??
                    `default-room-${profile.username}-${req.params.agentId}`
            );
            const newAgentId = stringToUuid(name);

            // Create agent config from user credentials
            const agentConfig: AgentConfig = {
                prompt,
                name,
                clients: ["direct"],
                modelProvider: "openai",
                bio: [profile.bio || `I am ${name}`],
                x: {
                    username: credentials.username,
                    email: credentials.email,
                    password: credentials.password,
                },
                style: {
                    all: [],
                    chat: [],
                    post: [],
                },
                adjectives: [],
                lore: [],
                knowledge: [],
                topics: [],
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
            if (this.registerCallbackFn) {
                await this.registerCallbackFn(agentConfig, memory);
            }

            return { agentId: newAgentId };
        });
    }
}
