/**
 * Financial analysis tools for the finance agent.
 *
 * Each tool implements a financial data or analysis operation.
 * In production, replace mock data with real API calls
 * (Yahoo Finance, SEC EDGAR, Alpha Vantage, etc.).
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ToolExecutor, ToolExecuteResult } from "@earendil-works/agent-base";
import { Type } from "@earendil-works/pi-ai";

// ─────────────────────────────────────────────────────────────
// Mock data stores (replace with real API integration)
// ─────────────────────────────────────────────────────────────

const MOCK_PRICES: Record<string, { price: number; change: number; currency: string }> = {
  AAPL: { price: 198.50, change: 1.25, currency: "USD" },
  GOOGL: { price: 175.30, change: -0.80, currency: "USD" },
  MSFT: { price: 425.22, change: 2.10, currency: "USD" },
  AMZN: { price: 185.07, change: 0.45, currency: "USD" },
  TSLA: { price: 248.90, change: -3.20, currency: "USD" },
  NVDA: { price: 880.15, change: 15.40, currency: "USD" },
  0700: { price: 380.00, change: 5.50, currency: "HKD" },
};

const MOCK_COMPANIES: Record<string, { name: string; sector: string; industry: string; employees: number; description: string }> = {
  AAPL: {
    name: "Apple Inc.", sector: "Technology", industry: "Consumer Electronics",
    employees: 164000, description: "Designs, manufactures, and markets smartphones, personal computers, tablets, wearables, and accessories."
  },
  GOOGL: {
    name: "Alphabet Inc.", sector: "Technology", industry: "Internet Services",
    employees: 190000, description: "Provides online advertising, search, cloud computing, and various AI products."
  },
  MSFT: {
    name: "Microsoft Corporation", sector: "Technology", industry: "Software",
    employees: 221000, description: "Develops, licenses, and supports software, services, devices, and cloud solutions."
  },
};

const MOCK_RATIOS: Record<string, Record<string, number>> = {
  AAPL: { pe: 31.2, pb: 48.5, roe: 1.56, de: 1.82, currentRatio: 0.99, grossMargin: 0.46 },
  GOOGL: { pe: 26.8, pb: 7.2, roe: 0.27, de: 0.12, currentRatio: 2.06, grossMargin: 0.57 },
  MSFT: { pe: 37.5, pb: 13.1, roe: 0.35, de: 0.28, currentRatio: 1.32, grossMargin: 0.70 },
};

// ─────────────────────────────────────────────────────────────
// Tool definitions
// ─────────────────────────────────────────────────────────────

export class FinanceTools implements ToolExecutor {
  getTools(): AgentTool[] {
    return [
      {
        name: "get_stock_quote",
        description: "Get the latest stock price and daily change for a ticker symbol",
        parameters: Type.Object({
          ticker: Type.String({ description: "Stock ticker symbol, e.g. AAPL, TSLA, 0700.HK" }),
        }),
      },
      {
        name: "get_company_profile",
        description: "Get company overview: name, sector, industry, employees, description",
        parameters: Type.Object({
          ticker: Type.String({ description: "Stock ticker symbol" }),
        }),
      },
      {
        name: "get_financial_ratios",
        description: "Get key financial ratios: P/E, P/B, ROE, D/E, current ratio, gross margin",
        parameters: Type.Object({
          ticker: Type.String({ description: "Stock ticker symbol" }),
        }),
      },
      {
        name: "search_sec_filings",
        description: "Search SEC EDGAR filings by ticker and form type",
        parameters: Type.Object({
          ticker: Type.String({ description: "Stock ticker symbol" }),
          formType: Type.Optional(Type.String({ description: "Form type: 10-K, 10-Q, 8-K (default: 10-K)" })),
          limit: Type.Optional(Type.Number({ description: "Max results (default: 5)" })),
        }),
      },
      {
        name: "screen_by_metric",
        description: "Screen stocks by a financial metric threshold. Available metrics: pe, pb, roe, de, currentRatio, grossMargin",
        parameters: Type.Object({
          metric: Type.String({ description: "Metric name: pe, pb, roe, de, currentRatio, grossMargin" }),
          min: Type.Optional(Type.Number({ description: "Minimum value" })),
          max: Type.Optional(Type.Number({ description: "Maximum value" })),
        }),
      },
      {
        name: "calculate_ratio",
        description: "Calculate a financial ratio from raw input values",
        parameters: Type.Object({
          name: Type.String({ description: "Ratio name, e.g. P/E, ROE, Debt-to-Equity" }),
          values: Type.String({ description: "JSON object of input values, e.g. {\"netIncome\": 100, \"equity\": 500}" }),
        }),
      },
    ];
  }

  async execute(name: string, args: Record<string, unknown>): Promise<ToolExecuteResult> {
    switch (name) {
      case "get_stock_quote": return this.getStockQuote(args.ticker as string);
      case "get_company_profile": return this.getCompanyProfile(args.ticker as string);
      case "get_financial_ratios": return this.getFinancialRatios(args.ticker as string);
      case "search_sec_filings": return this.searchFilings(args.ticker as string, args.formType as string | undefined, args.limit as number | undefined);
      case "screen_by_metric": return this.screenByMetric(args.metric as string, args.min as number | undefined, args.max as number | undefined);
      case "calculate_ratio": return this.calculateRatio(args.name as string, args.values as string);
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  }

  // ─── Tool implementations ─────────────────────────────────

  private async getStockQuote(ticker: string): Promise<ToolExecuteResult> {
    const data = MOCK_PRICES[ticker];
    if (!data) {
      return { content: [{ type: "text", text: `No data found for ticker: ${ticker}` }], isError: true };
    }
    const sign = data.change >= 0 ? "+" : "";
    return {
      content: [{
        type: "text",
        text: [
          `**${ticker}** — ${data.currency}`,
          `Price: ${data.price.toFixed(2)}`,
          `Change: ${sign}${data.change.toFixed(2)} (${sign}${((data.change / (data.price - data.change)) * 100).toFixed(2)}%)`,
          `Updated: ${new Date().toISOString().slice(0, 16)}`,
        ].join("\n"),
      }],
      isError: false,
    };
  }

  private async getCompanyProfile(ticker: string): Promise<ToolExecuteResult> {
    const data = MOCK_COMPANIES[ticker];
    if (!data) {
      return { content: [{ type: "text", text: `No company profile for: ${ticker}` }], isError: true };
    }
    return {
      content: [{
        type: "text",
        text: [
          `**${data.name}** (${ticker})`,
          `Sector: ${data.sector}`,
          `Industry: ${data.industry}`,
          `Employees: ${data.employees.toLocaleString()}`,
          ``,
          data.description,
        ].join("\n"),
      }],
      isError: false,
    };
  }

  private async getFinancialRatios(ticker: string): Promise<ToolExecuteResult> {
    const ratios = MOCK_RATIOS[ticker];
    if (!ratios) {
      return { content: [{ type: "text", text: `No ratios for: ${ticker}` }], isError: true };
    }
    return {
      content: [{
        type: "text",
        text: [
          `**${ticker} — Key Financial Ratios**`,
          `P/E Ratio: ${ratios.pe.toFixed(1)}`,
          `P/B Ratio: ${ratios.pb.toFixed(1)}`,
          `ROE: ${(ratios.roe * 100).toFixed(1)}%`,
          `Debt-to-Equity: ${ratios.de.toFixed(2)}`,
          `Current Ratio: ${ratios.currentRatio.toFixed(2)}`,
          `Gross Margin: ${(ratios.grossMargin * 100).toFixed(1)}%`,
        ].join("\n"),
      }],
      isError: false,
    };
  }

  private async searchFilings(ticker: string, formType?: string, limit?: number): Promise<ToolExecuteResult> {
    const form = formType ?? "10-K";
    const count = limit ?? 5;
    // In production, query SEC EDGAR API
    return {
      content: [{
        type: "text",
        text: [
          `**SEC EDGAR Filings for ${ticker}**`,
          `Form: ${form} | Limit: ${count}`,
          ``,
          ...Array.from({ length: count }, (_, i) => {
            const year = new Date().getFullYear() - i;
            return `${i + 1}. ${ticker}_${form}_${year}.pdf  (filed: ${year}-02-${String(15 + i * 5).padStart(2, "0")})`;
          }),
          ``,
          `*Data source: SEC EDGAR (mock)*`,
        ].join("\n"),
      }],
      isError: false,
    };
  }

  private async screenByMetric(metric: string, min?: number, max?: number): Promise<ToolExecuteResult> {
    const results = Object.entries(MOCK_RATIOS)
      .filter(([, ratios]) => {
        const val = ratios[metric];
        if (val === undefined) return false;
        if (min !== undefined && val < min) return false;
        if (max !== undefined && val > max) return false;
        return true;
      })
      .map(([ticker, ratios]) => {
        const name = MOCK_COMPANIES[ticker]?.name ?? ticker;
        return `${ticker} (${name}): ${metric} = ${ratios[metric]}`;
      });

    return {
      content: [{
        type: "text",
        text: results.length > 0
          ? `**Screen Results:** ${metric}\n\n${results.join("\n")}`
          : `No tickers match the criteria for metric "${metric}".`,
      }],
      isError: false,
    };
  }

  private async calculateRatio(name: string, jsonValues: string): Promise<ToolExecuteResult> {
    try {
      const values = JSON.parse(jsonValues) as Record<string, number>;
      const entries = Object.entries(values).map(([k, v]) => `${k}: ${v}`).join("\n");
      return {
        content: [{
          type: "text",
          text: [
            `**${name} Calculation**`,
            ``,
            `Input values:`,
            entries,
            ``,
            `*Formula: ${name}*`,
            `*Result depends on the specific formula applied.*`,
          ].join("\n"),
        }],
        isError: false,
      };
    } catch {
      return { content: [{ type: "text", text: "Invalid JSON input. Use format: {\"key\": value}" }], isError: true };
    }
  }
}
