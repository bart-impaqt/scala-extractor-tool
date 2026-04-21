"use client";

import { FormEvent, useState } from "react";

type ExtractedFilial = {
  key: string;
  countryCode: string;
  filialType: string;
  filialCode: string;
  screenCount: number;
  exampleNames: string[];
};

type ExtractResponse = {
  summary: {
    extractedAt: string;
    totalFromApi: number;
    fetched: number;
    matchedPlayers: number;
    matchedFilials: number;
    parsed: number;
    unparsed: number;
    matchedParsedPlayers: number;
    matchedUnparsedPlayers: number;
    pageSizeUsed: number;
    filters: {
      countries: string[];
      filialTypes: string[];
      filialCodes: string[];
      nameIncludes: string[];
    };
  };
  filials: ExtractedFilial[];
  error?: string;
};

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return value;
}

function triggerDownload(content: string, fileName: string, contentType: string): void {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [countries, setCountries] = useState("AT,BE");
  const [filialTypes, setFilialTypes] = useState("EV,AB");
  const [filialCodes, setFilialCodes] = useState("");
  const [nameIncludes, setNameIncludes] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractResponse | null>(null);

  const canSubmit = !isLoading;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/scala/players", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          countries,
          filialTypes,
          filialCodes,
          nameIncludes,
        }),
      });

      const payload = (await response.json()) as ExtractResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? `Request failed with HTTP ${response.status}`);
      }

      setResult(payload);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unexpected request error.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const downloadJson = () => {
    if (!result) {
      return;
    }

    const content = JSON.stringify(result.filials, null, 2);
    triggerDownload(content, "scala-filials.json", "application/json");
  };

  const downloadCsv = () => {
    if (!result) {
      return;
    }

    const headers = [
      "Filial Key",
      "Country Code",
      "Filial Type",
      "Filial Code",
      "Screen Count",
      "Example Player 1",
      "Example Player 2",
      "Example Player 3",
    ];
    const rows = result.filials.map((filial) =>
      [
        filial.key,
        filial.countryCode,
        filial.filialType,
        filial.filialCode,
        String(filial.screenCount),
        filial.exampleNames[0] ?? "",
        filial.exampleNames[1] ?? "",
        filial.exampleNames[2] ?? "",
      ]
        .map(csvEscape)
        .join(","),
    );

    // Include UTF-8 BOM so Excel opens labels/special chars correctly.
    const csv = `\uFEFF${[headers.join(","), ...rows].join("\r\n")}`;
    triggerDownload(csv, "scala-filials.csv", "text/csv;charset=utf-8");
  };

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
      <main className="mx-auto w-full max-w-6xl space-y-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h1 className="text-2xl font-semibold tracking-tight">
            SCALA Content Manager Extractor
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Extract unique filials and filter by country, filial type (EV/AB), filial
            codes, and multiple name terms.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Connection config is loaded from environment variables:{" "}
            <code>SCALA_CM_BASE_URL</code>, <code>SCALA_CM_API_TOKEN</code> or{" "}
            <code>SCALA_CM_USERNAME</code>/<code>SCALA_CM_PASSWORD</code>, and optional{" "}
            <code>SCALA_CM_NETWORK_ID</code>.
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">
                  Countries (comma separated)
                </span>
                <input
                  value={countries}
                  onChange={(event) => setCountries(event.target.value)}
                  placeholder="AT,BE"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none ring-sky-500 focus:ring-2"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">
                  Filial Types (comma separated)
                </span>
                <input
                  value={filialTypes}
                  onChange={(event) => setFilialTypes(event.target.value)}
                  placeholder="EV,AB"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none ring-sky-500 focus:ring-2"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">
                  Filial Codes (optional)
                </span>
                <input
                  value={filialCodes}
                  onChange={(event) => setFilialCodes(event.target.value)}
                  placeholder="2300,0402"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none ring-sky-500 focus:ring-2"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">
                  Name contains terms (optional)
                </span>
                <input
                  value={nameIncludes}
                  onChange={(event) => setNameIncludes(event.target.value)}
                  placeholder="Wien,Kapellen,Antwerpen"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none ring-sky-500 focus:ring-2"
                />
                <span className="mt-1 block text-xs text-slate-500">
                  Use comma, space, or semicolon between multiple terms.
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? "Extracting..." : "Extract Filials"}
            </button>
          </form>

          {error ? (
            <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </p>
          ) : null}
        </section>

        {result ? (
          <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-700">
                <p>
                  API total: <strong>{result.summary.totalFromApi}</strong> | fetched:{" "}
                  <strong>{result.summary.fetched}</strong> players | matched:{" "}
                  <strong>{result.summary.matchedPlayers}</strong> players /{" "}
                  <strong>{result.summary.matchedFilials}</strong> filials
                </p>
                <p>
                  Parsed: <strong>{result.summary.parsed}</strong> | unparsed:{" "}
                  <strong>{result.summary.unparsed}</strong> | matched parsed:{" "}
                  <strong>{result.summary.matchedParsedPlayers}</strong> | extracted at:{" "}
                  <strong>{new Date(result.summary.extractedAt).toLocaleString()}</strong>
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={downloadJson}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  Download JSON
                </button>
                <button
                  type="button"
                  onClick={downloadCsv}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  Download CSV
                </button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 font-medium">Country</th>
                    <th className="px-3 py-2 font-medium">Filial Type</th>
                    <th className="px-3 py-2 font-medium">Filial Code</th>
                    <th className="px-3 py-2 font-medium">Screens</th>
                    <th className="px-3 py-2 font-medium">Examples</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.filials.map((filial) => (
                    <tr key={filial.key}>
                      <td className="whitespace-nowrap px-3 py-2">
                        {filial.countryCode}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {filial.filialType}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {filial.filialCode}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {filial.screenCount}
                      </td>
                      <td className="px-3 py-2">
                        {filial.exampleNames.join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.filials.length === 0 ? (
              <p className="text-sm text-slate-600">
                No filials matched the current filters.
              </p>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
