export type Coordinates = {
  latitude: number;
  longitude: number;
};

export const directions = [
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
] as const;

export type Direction = (typeof directions)[number];

const bearings: Record<Direction, number> = {
  north: 0,
  northeast: 45,
  east: 90,
  southeast: 135,
  south: 180,
  southwest: 225,
  west: 270,
  northwest: 315,
};

const earthRadiusMeters = 6_371_000;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

export function calculatePosition(
  reference: Coordinates,
  direction: Direction,
  distanceMeters: number,
): Coordinates {
  if (
    !Number.isFinite(reference.latitude) ||
    reference.latitude < -90 ||
    reference.latitude > 90 ||
    !Number.isFinite(reference.longitude) ||
    reference.longitude < -180 ||
    reference.longitude > 180
  ) {
    throw new Error("Reference coordinates are outside valid bounds");
  }
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    throw new Error("distance_meters must be greater than zero");
  }

  const angularDistance = distanceMeters / earthRadiusMeters;
  const bearing = toRadians(bearings[direction]);
  const latitude = toRadians(reference.latitude);
  const longitude = toRadians(reference.longitude);

  const resultLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
      Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const resultLongitude =
    longitude +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(resultLatitude),
    );

  return {
    latitude: toDegrees(resultLatitude),
    longitude: ((toDegrees(resultLongitude) + 540) % 360) - 180,
  };
}

