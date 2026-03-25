import { Module } from "@nestjs/common"
import { WebSearchService } from "./websearch.service"

@Module({
  providers: [WebSearchService],
  exports: [WebSearchService],
})
export class WebSearchModule {}
