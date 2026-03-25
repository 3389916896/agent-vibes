import { Module } from "@nestjs/common"
import { HistoryModule } from "../../context/history.module"
import { NativeModule } from "../native/native.module"
import { GoogleModelCacheService } from "./google-model-cache.service"
import { GoogleService } from "./google.service"
import { ToolThoughtSignatureService } from "./tool-thought-signature.service"

@Module({
  imports: [HistoryModule, NativeModule],
  providers: [
    GoogleModelCacheService,
    GoogleService,
    ToolThoughtSignatureService,
  ],
  exports: [
    GoogleService,
    GoogleModelCacheService,
    ToolThoughtSignatureService,
  ],
})
export class GoogleModule {}
