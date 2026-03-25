import { Module } from "@nestjs/common"
import { ProcessPoolService } from "./process-pool.service"

@Module({
  providers: [ProcessPoolService],
  exports: [ProcessPoolService],
})
export class NativeModule {}
