import { notFound } from "next/navigation";
import WeekScreen from "@/components/WeekScreen";

export const revalidate = 60;

export default async function WeekPage({
  params,
}: {
  params: Promise<{ n: string }>;
}) {
  const { n } = await params;
  const week = Number(n);
  if (!Number.isInteger(week) || week < 1 || week > 18) notFound();
  return <WeekScreen week={week} />;
}
