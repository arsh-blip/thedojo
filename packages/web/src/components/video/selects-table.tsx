"use client";

import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface VideoSelect {
  file: string;
  sceneType: string;
  start: number;
  end: number;
  duration: number;
  score: number;
  description: string;
}

interface SelectsTableProps {
  selects: VideoSelect[];
}

type SortDir = "asc" | "desc" | null;

function formatTimecode(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.round((seconds % 1) * 30);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}:${f.toString().padStart(2, "0")}`;
}

export function SelectsTable({ selects }: SelectsTableProps) {
  const [sceneTypeFilter, setSceneTypeFilter] = useState<string>("all");
  const [minScore, setMinScore] = useState<number>(0);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const sceneTypes = useMemo(() => {
    const types = new Set(selects.map((s) => s.sceneType));
    return Array.from(types).sort();
  }, [selects]);

  const filtered = useMemo(() => {
    let result = selects;

    if (sceneTypeFilter !== "all") {
      result = result.filter((s) => s.sceneType === sceneTypeFilter);
    }

    if (minScore > 0) {
      result = result.filter((s) => s.score >= minScore);
    }

    if (sortDir) {
      result = [...result].sort((a, b) =>
        sortDir === "asc" ? a.score - b.score : b.score - a.score
      );
    }

    return result;
  }, [selects, sceneTypeFilter, minScore, sortDir]);

  const toggleSort = () => {
    setSortDir((prev) => {
      if (prev === null) return "desc";
      if (prev === "desc") return "asc";
      return null;
    });
  };

  const SortIcon =
    sortDir === "asc" ? ArrowUp : sortDir === "desc" ? ArrowDown : ArrowUpDown;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <Label>Scene Type</Label>
          <Select value={sceneTypeFilter} onValueChange={setSceneTypeFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {sceneTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="min-score">Min Score</Label>
          <Input
            id="min-score"
            type="number"
            min={0}
            max={100}
            step={1}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="w-[100px]"
          />
        </div>

        <div className="text-sm text-muted-foreground">
          {filtered.length} of {selects.length} selects
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>File</TableHead>
            <TableHead>Scene Type</TableHead>
            <TableHead>Start</TableHead>
            <TableHead>End</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>
              <Button
                variant="ghost"
                size="xs"
                onClick={toggleSort}
                className="-ml-2 gap-1"
              >
                Score
                <SortIcon className="size-3" />
              </Button>
            </TableHead>
            <TableHead>Description</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                No selects match the current filters.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((s, i) => (
              <TableRow key={`${s.file}-${s.start}-${i}`}>
                <TableCell className="max-w-[200px] truncate font-mono text-xs">
                  {s.file}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{s.sceneType}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {formatTimecode(s.start)}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {formatTimecode(s.end)}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {s.duration.toFixed(1)}s
                </TableCell>
                <TableCell className="font-medium">{s.score}</TableCell>
                <TableCell className="max-w-[300px] truncate text-xs text-muted-foreground">
                  {s.description}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
