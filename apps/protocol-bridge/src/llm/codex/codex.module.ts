import { Module } from "@nestjs/common"
import { CodexAuthService } from "./codex-auth.service"
import { CodexCacheService } from "./codex-cache.service"
import { CodexWebSocketService } from "./codex-websocket.service"
import { CodexService } from "./codex.service"

@Module({
  providers: [
    CodexAuthService,
    CodexCacheService,
    CodexWebSocketService,
    CodexService,
  ],
  exports: [
    CodexAuthService,
    CodexCacheService,
    CodexWebSocketService,
    CodexService,
  ],
})
export class CodexModule {}
