export function decodeHeartRate(dataView) {
  if (dataView.byteLength < 2) return null;
  const is16Bit = (dataView.getUint8(0) & 0x01) !== 0;
  if (is16Bit && dataView.byteLength < 3) return null;
  return is16Bit
    ? dataView.getUint16(1, true)
    : dataView.getUint8(1);
}

export function decodeCyclingPower(dataView) {
  if (dataView.byteLength < 4) return null;
  const flags = dataView.getUint16(0, true);
  return (flags & 0x01) !== 0
    ? dataView.getInt16(2, true)
    : null;
}

export function createCscDecoder() {
  let lastWheelRevs = null;
  let lastWheelTime = null;
  let lastCrankRevs = null;
  let lastCrankTime = null;

  return function decodeCsc(dataView) {
    if (dataView.byteLength < 1) return null;
    const metrics = {};
    const flags = dataView.getUint8(0);
    let offset = 1;

    if ((flags & 0x01) !== 0 && dataView.byteLength >= offset + 6) {
      const wheelRevs = dataView.getUint32(offset, true);
      const wheelTime = dataView.getUint16(offset + 4, true);
      offset += 6;

      if (lastWheelRevs !== null && lastWheelTime !== null) {
        let revsDiff = wheelRevs - lastWheelRevs;
        if (revsDiff < 0) revsDiff += 4294967296;

        let timeDiff = wheelTime - lastWheelTime;
        if (timeDiff < 0) timeDiff += 65536;

        if (timeDiff > 0 && revsDiff > 0) {
          const revolutionsPerSecond = revsDiff / (timeDiff / 1024);
          metrics.speedKph = revolutionsPerSecond * 2.1 * 3.6;
          metrics.hasWheelRevolution = true;
        } else if (timeDiff > 0) {
          metrics.speedKph = 0;
          metrics.hasWheelRevolution = false;
        }
      }
      lastWheelRevs = wheelRevs;
      lastWheelTime = wheelTime;
    }

    if ((flags & 0x02) !== 0 && dataView.byteLength >= offset + 4) {
      const crankRevs = dataView.getUint16(offset, true);
      const crankTime = dataView.getUint16(offset + 2, true);

      if (lastCrankRevs !== null && lastCrankTime !== null) {
        let revsDiff = crankRevs - lastCrankRevs;
        if (revsDiff < 0) revsDiff += 65536;

        let timeDiff = crankTime - lastCrankTime;
        if (timeDiff < 0) timeDiff += 65536;

        if (timeDiff > 0 && revsDiff > 0) {
          metrics.cadenceRpm = Math.round(
            (revsDiff / (timeDiff / 1024)) * 60,
          );
        }
      }
      lastCrankRevs = crankRevs;
      lastCrankTime = crankTime;
    }

    return Object.keys(metrics).length > 0 ? metrics : null;
  };
}

export function decodeIndoorBikeData(dataView) {
  if (dataView.byteLength < 2) return null;
  const metrics = {};
  const flags = dataView.getUint16(0, true);
  let offset = 2;

  if ((flags & 0x01) === 0) {
    if (dataView.byteLength >= offset + 2) {
      const speedKph = dataView.getUint16(offset, true) / 100;
      metrics.speedKph = speedKph;
      metrics.hasWheelRevolution = speedKph > 0;
      offset += 2;
    }
  }

  if ((flags & 0x02) !== 0) offset += 2;

  if ((flags & 0x04) !== 0) {
    if (dataView.byteLength >= offset + 2) {
      metrics.cadenceRpm = Math.round(dataView.getUint16(offset, true) * 0.5);
      offset += 2;
    }
  }

  if ((flags & 0x08) !== 0) offset += 2;
  if ((flags & 0x10) !== 0) offset += 3;
  if ((flags & 0x20) !== 0) offset += 2;

  if ((flags & 0x40) !== 0 && dataView.byteLength >= offset + 2) {
    metrics.powerWatts = dataView.getInt16(offset, true);
  }

  return Object.keys(metrics).length > 0 ? metrics : null;
}

export function decodeFtmsControlResponse(dataView) {
  if (dataView.byteLength < 3 || dataView.getUint8(0) !== 0x80) return null;
  return {
    requestOpCode: dataView.getUint8(1),
    resultCode: dataView.getUint8(2),
  };
}
