import { Injectable, Logger } from "@nestjs/common"

interface ToolDefinition {
  type?: string
  name?: string
  description?: string
  input_schema?: Record<string, unknown>
}

@Injectable()
export class WebSearchService {
  private readonly logger = new Logger(WebSearchService.name)

  /**
   * Check if the tools array contains a web_search tool
   * Supports various naming conventions: web_search, WebSearch, web_search_20250305, etc.
   */
  hasWebSearchTool(tools?: ToolDefinition[]): boolean {
    if (!tools || tools.length === 0) {
      return false
    }

    const result = tools.some((tool) => {
      const toolType = tool.type?.toLowerCase() || ""
      const toolName = tool.name?.toLowerCase() || ""

      const isWebSearch =
        toolType.includes("web_search") ||
        toolType.includes("websearch") ||
        toolName.includes("web_search") ||
        toolName.includes("websearch")

      if (isWebSearch) {
        this.logger.log(
          `Detected web search tool: type=${tool.type}, name=${tool.name}`
        )
      }

      return isWebSearch
    })

    return result
  }

  /**
   * Filter out web_search tools and return only custom tools
   */
  filterCustomTools(tools?: ToolDefinition[]): ToolDefinition[] {
    if (!tools || tools.length === 0) {
      return []
    }

    return tools.filter((tool) => {
      const toolType = tool.type?.toLowerCase() || ""
      const toolName = tool.name?.toLowerCase() || ""

      return (
        !toolType.includes("web_search") &&
        !toolType.includes("websearch") &&
        !toolName.includes("web_search") &&
        !toolName.includes("websearch")
      )
    })
  }
}
