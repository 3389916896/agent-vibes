import { create, toBinary } from "@bufbuild/protobuf"
import { Controller, Logger, Post, Req, Res } from "@nestjs/common"
import { FastifyReply, FastifyRequest } from "fastify"
import { CodexService } from "../../llm/codex/codex.service"
import { getCursorDisplayModels } from "../../llm/model-registry"
import { connectRPCHandler } from "./connect-rpc-handler"
import { CursorConnectStreamService } from "./cursor-connect-stream.service"
import {
  GetAllowedModelIntentsResponseSchema,
  GetUsableModelsResponseSchema,
  ModelDetailsSchema,
  NameAgentResponseSchema,
} from "../../gen/agent/v1_pb"

/**
 * Cursor ConnectRPC Adapter Controller
 * Only exposes agent.v1 endpoints.
 */
@Controller()
export class CursorAdapterController {
  private readonly logger = new Logger(CursorAdapterController.name)

  constructor(
    private readonly connectStreamService: CursorConnectStreamService,
    private readonly codexService: CodexService
  ) {}

  /**
   * Main chat streaming endpoint - HTTP/2 bidirectional streaming
   */
  @Post("agent.v1.AgentService/Run")
  async handleAgentRun(
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply
  ): Promise<void> {
    this.logger.log(">>> AgentService/Run request received")

    try {
      await connectRPCHandler.handleBidiStream(
        req,
        res,
        async (inputMessages, output) => {
          this.logger.log(">>> AgentService/Run - handleBidiStream callback")

          const outputGenerator =
            this.connectStreamService.handleBidiStream(inputMessages)

          let responseCount = 0
          for await (const responseBuffer of outputGenerator) {
            responseCount++
            this.logger.debug(
              `>>> Agent response #${responseCount}: ${responseBuffer.length} bytes`
            )
            output(responseBuffer)
          }
          this.logger.log(
            `>>> AgentService/Run sent ${responseCount} responses`
          )
        }
      )
    } catch (error) {
      this.logger.error("Error in AgentService/Run", error)
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      throw new Error(`Agent run failed: ${errorMessage}`)
    }
  }

  /**
   * agent.v1.AgentService/NameAgent - Get agent name suggestion
   */
  @Post("agent.v1.AgentService/NameAgent")
  handleAgentName(@Res() res: FastifyReply): void {
    this.logger.log(">>> AgentService/NameAgent request received")
    res.header("Content-Type", "application/proto")
    res.header("Connect-Protocol-Version", "1")
    const response = create(NameAgentResponseSchema, { name: "New Agent" })
    res
      .status(200)
      .send(Buffer.from(toBinary(NameAgentResponseSchema, response)))
  }

  /**
   * agent.v1.AgentService/GetUsableModels - Return available models for Agent
   */
  @Post("agent.v1.AgentService/GetUsableModels")
  handleAgentGetUsableModels(@Res() res: FastifyReply): void {
    this.logger.log(">>> AgentService/GetUsableModels request received")
    res.header("Content-Type", "application/proto")
    res.header("Connect-Protocol-Version", "1")
    const models = getCursorDisplayModels({
      includeCodex: this.codexService.isAvailable(),
      codexModelTier: this.codexService.getModelTier(),
    }).map((model) =>
      create(ModelDetailsSchema, {
        modelId: model.name,
        displayModelId: model.name,
        displayName: model.displayName,
        displayNameShort: model.shortName,
        aliases: [],
        maxMode: model.name.includes("max"),
      })
    )
    const response = create(GetUsableModelsResponseSchema, { models })
    res
      .status(200)
      .send(Buffer.from(toBinary(GetUsableModelsResponseSchema, response)))
  }

  /**
   * agent.v1.AgentService/GetAllowedModelIntents
   */
  @Post("agent.v1.AgentService/GetAllowedModelIntents")
  handleAgentGetAllowedModelIntents(@Res() res: FastifyReply): void {
    this.logger.log(">>> AgentService/GetAllowedModelIntents request received")
    res.header("Content-Type", "application/proto")
    res.header("Connect-Protocol-Version", "1")
    const response = create(GetAllowedModelIntentsResponseSchema, {
      modelIntents: [],
    })
    res
      .status(200)
      .send(
        Buffer.from(toBinary(GetAllowedModelIntentsResponseSchema, response))
      )
  }
}
