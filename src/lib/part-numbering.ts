import { normalizeString } from "./manufacturing";

export interface NumberingSubsystem {
  label: string;
  prefix: string;
  aliases: string[];
  airtableNames: string[];
}

export const NUMBERING_SUBSYSTEMS: NumberingSubsystem[] = [
  {
    label: "Drive",
    prefix: "0100",
    aliases: ["drive", "drivebase", "drivetrain"],
    airtableNames: ["Drive", "Drivebase", "Drivetrain"],
  },
  {
    label: "Bumpers",
    prefix: "0200",
    aliases: ["bumpers", "bumper"],
    airtableNames: ["Bumpers", "Bumper"],
  },
  {
    label: "Intake",
    prefix: "0300",
    aliases: ["intake"],
    airtableNames: ["Intake"],
  },
  {
    label: "Hopper Walls",
    prefix: "0400",
    aliases: ["hopper walls", "hopper wall", "hopper"],
    airtableNames: ["Hopper Walls", "Hopper Wall"],
  },
  {
    label: "Hopper Floor",
    prefix: "0500",
    aliases: ["hopper floor"],
    airtableNames: ["Hopper Floor"],
  },
  {
    label: "Funnel",
    prefix: "0600",
    aliases: ["funnel"],
    airtableNames: ["Funnel"],
  },
  {
    label: "Shooter/Turret",
    prefix: "0700",
    aliases: ["shooter", "turret", "shooter turret", "shooter/turret"],
    airtableNames: ["Shooter", "Turret", "Shooter/Turret"],
  },
];

const nonNumberedSubsystems = new Set(["cheesycare", "pit"]);
const overflowPrefixDigits = "09";
const maxTwoDigitSequence = 99;

function normalizedKey(value: unknown) {
  return normalizeString(value).toLowerCase();
}

export function isNonNumberedSubsystem(value: unknown) {
  return nonNumberedSubsystems.has(normalizedKey(value));
}

export function numberingSubsystemFromName(value: unknown) {
  const normalized = normalizedKey(value);
  if (!normalized || isNonNumberedSubsystem(normalized)) {
    return undefined;
  }

  return NUMBERING_SUBSYSTEMS.find(
    (subsystem) =>
      subsystem.label.toLowerCase() === normalized ||
      subsystem.aliases.some((alias) => alias.toLowerCase() === normalized) ||
      subsystem.airtableNames.some((name) => name.toLowerCase() === normalized),
  );
}

function partNumberCore(value: unknown) {
  const partNumber = normalizeString(value);
  if (!partNumber) {
    return "";
  }

  return partNumber.match(/(\d{4})(?!.*\d)/)?.[1] ?? "";
}

export function numberingSubsystemFromPartNumber(value: unknown) {
  const core = partNumberCore(value);
  if (!core) {
    return undefined;
  }

  return NUMBERING_SUBSYSTEMS.find(
    (subsystem) => subsystem.prefix.slice(0, 2) === core.slice(0, 2),
  );
}

export function subsystemChoiceForPartNumber(
  partNumber: unknown,
  choices: readonly string[] = [],
) {
  const subsystem = numberingSubsystemFromPartNumber(partNumber);
  if (!subsystem) {
    return "";
  }

  if (choices.length === 0) {
    return subsystem.label;
  }

  const candidates = new Set(
    [subsystem.label, ...subsystem.aliases, ...subsystem.airtableNames].map(
      (value) => value.toLowerCase(),
    ),
  );

  return (
    choices.find((choice) => candidates.has(choice.toLowerCase())) ??
    subsystem.label
  );
}

export function generatedPartNumberPrefix() {
  const configuredPrefix = normalizeString(
    process.env.PART_NUMBER_PREFIX ?? process.env.CHEESY_PART_NUMBER_PREFIX,
  );
  if (configuredPrefix) {
    return configuredPrefix;
  }

  return `${String(new Date().getFullYear()).slice(-2)}-P-`;
}

function maxSequenceForPrefix(
  existingPartNumbers: readonly string[],
  prefixDigits: string,
) {
  return existingPartNumbers.reduce((max, partNumber) => {
    const core = partNumberCore(partNumber);
    if (!core || core.slice(0, 2) !== prefixDigits) {
      return max;
    }

    const sequence = Number.parseInt(core.slice(2), 10);
    return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
  }, 0);
}

function coreForPrefix(prefixDigits: string, sequence: number) {
  return `${prefixDigits}${String(sequence).padStart(2, "0")}`;
}

export function nextPartNumberForSubsystem(input: {
  subsystem: string;
  existingPartNumbers: readonly string[];
}) {
  const subsystem = numberingSubsystemFromName(input.subsystem);
  if (!subsystem) {
    throw new Error(`${input.subsystem || "Subsystem"} cannot receive part numbers.`);
  }

  const prefixDigits = subsystem.prefix.slice(0, 2);
  const maxExisting = maxSequenceForPrefix(
    input.existingPartNumbers,
    prefixDigits,
  );
  const nextSequence = maxExisting + 1;

  let core = coreForPrefix(prefixDigits, nextSequence);

  if (nextSequence > maxTwoDigitSequence) {
    const overflowSequence =
      maxSequenceForPrefix(input.existingPartNumbers, overflowPrefixDigits) + 1;
    if (overflowSequence > maxTwoDigitSequence) {
      throw new Error("The 09xx overflow part number range has been used up.");
    }

    core = coreForPrefix(overflowPrefixDigits, overflowSequence);
  }

  return {
    subsystem,
    core,
    partNumber: `${generatedPartNumberPrefix()}${core}`,
  };
}
