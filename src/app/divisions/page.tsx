import { getSeasonContext, getSeasonLockTime } from "@/lib/espn";
import { getConferenceGroups } from "@/lib/divisions";
import DivisionScreen from "@/components/DivisionScreen";

export const revalidate = 60;

export default async function DivisionsPage() {
  const context = await getSeasonContext();
  const season = context.season;
  const [afc, nfc, lockTime] = await Promise.all([
    getConferenceGroups("AFC"),
    getConferenceGroups("NFC"),
    getSeasonLockTime(season),
  ]);
  const locked = lockTime !== null && lockTime <= Date.now();

  return (
    <DivisionScreen
      season={season}
      groups={{ AFC: afc, NFC: nfc }}
      initialLocked={locked}
      lockTime={lockTime}
    />
  );
}
