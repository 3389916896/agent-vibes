import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger"
import { IsString, IsArray, IsOptional, ValidateNested } from "class-validator"
import { Type } from "class-transformer"

class MessageContentDto {
  @ApiProperty()
  @IsString()
  type: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  text?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  id?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string

  @ApiPropertyOptional()
  @IsOptional()
  input?: Record<string, unknown>

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  tool_use_id?: string
}

class MessageDto {
  @ApiProperty({ enum: ["user", "assistant"] })
  @IsString()
  role: string

  @ApiProperty({ oneOf: [{ type: "string" }, { type: "array" }] })
  @IsOptional()
  content: string | MessageContentDto[]
}

class ToolDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  type?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string

  @ApiPropertyOptional()
  @IsOptional()
  input_schema?: Record<string, unknown>
}

/**
 * DTO for Anthropic count_tokens API
 * Reference: https://docs.anthropic.com/en/api/messages-count-tokens
 */
export class CountTokensDto {
  @ApiProperty({ example: "claude-sonnet-4-20250514" })
  @IsString()
  model: string

  @ApiProperty({ type: [MessageDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageDto)
  messages: MessageDto[]

  @ApiPropertyOptional()
  @IsOptional()
  system?: string | MessageContentDto[]

  @ApiPropertyOptional({ type: [ToolDto] })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ToolDto)
  tools?: ToolDto[]
}
