"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { jobs, type Job } from "@/lib/api-client";
import { Film, FolderOpen, Presentation } from "lucide-react";

const quickActions = [
  {
    href: "/video",
    label: "Upload Videos",
    description: "Analyze footage and generate Premiere Pro projects",
    icon: Film,
  },
  {
    href: "/drive",
    label: "Browse Drive",
    description: "Navigate client folders and files",
    icon: FolderOpen,
  },
  {
    href: "/concept",
    label: "New Concept",
    description: "Build and push concept slides",
    icon: Presentation,
  },
];

function statusColor(status: Job["status"]) {
  switch (status) {
    case "queued":
      return "secondary" as const;
    case "running":
      return "default" as const;
    case "completed":
      return "outline" as const;
    case "failed":
      return "destructive" as const;
  }
}

export default function Dashboard() {
  const { data: recentJobs } = useQuery({
    queryKey: ["jobs"],
    queryFn: () => jobs.list(),
    refetchInterval: 5000,
  });

  return (
    <>
      <Header
        title="Dashboard"
        description="Creative strategy and video analysis hub"
      />

      <div className="p-6 space-y-6">
        {/* Quick Actions */}
        <section>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">
            Quick Actions
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {quickActions.map(({ href, label, description, icon: Icon }) => (
              <Link key={href} href={href}>
                <Card className="hover:border-primary/30 transition-colors cursor-pointer h-full">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Icon className="h-4 w-4" />
                      {label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {description}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>

        {/* Recent Jobs */}
        <section>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">
            Recent Jobs
          </h2>
          {recentJobs && recentJobs.length > 0 ? (
            <div className="space-y-2">
              {recentJobs.slice(0, 10).map((job) => (
                <Link
                  key={job.id}
                  href={`/video/${job.id}`}
                >
                  <Card className="hover:border-primary/30 transition-colors cursor-pointer">
                    <CardContent className="flex items-center justify-between py-3">
                      <div className="flex items-center gap-3">
                        <Film className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">
                            {job.type.replace(/_/g, " ")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(job.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <Badge variant={statusColor(job.status)}>
                        {job.status}
                      </Badge>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No jobs yet. Upload some videos to get started.
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </>
  );
}
