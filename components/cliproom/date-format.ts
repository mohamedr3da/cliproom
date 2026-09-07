const dateOptions: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
};

const dateTimeOptions: Intl.DateTimeFormatOptions = {
  ...dateOptions,
  second: "2-digit",
  timeZoneName: "short",
};

function formatDate(value: string | null, options: Intl.DateTimeFormatOptions) {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", options).format(date);
}

export function formatUserDate(value: string | null) {
  return formatDate(value, dateOptions);
}

export function formatUserDateTime(value: string | null) {
  return formatDate(value, dateTimeOptions);
}
