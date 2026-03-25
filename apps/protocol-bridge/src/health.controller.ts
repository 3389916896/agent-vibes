import { Controller, Get, Post } from "@nestjs/common"
import { ApiOperation, ApiTags } from "@nestjs/swagger"
import { ProcessPoolService } from "./llm/native/process-pool.service"

@ApiTags("Health")
@Controller()
export class HealthController {
  constructor(private readonly processPool: ProcessPoolService) {}

  @Get("health")
  @ApiOperation({ summary: "Health check endpoint" })
  health() {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
    }
  }

  @Get("pool/status")
  @ApiOperation({ summary: "Get native process pool status" })
  getPoolStatus() {
    return this.processPool.getStatus()
  }

  @Post("pool/check")
  @ApiOperation({ summary: "Check Cloud Code availability via native process" })
  async checkAvailability() {
    const available = await this.processPool.checkAvailability()
    return {
      timestamp: new Date().toISOString(),
      available,
    }
  }
}
