/* bluetooth.js - Web Bluetooth & Virtual Simulator Manager for RodilloInt */
import { state } from "./modules/state.js";

// Bluetooth UUIDs
const SERVICES = {
  HRM: "heart_rate", // 0x180d
  POWER: "cycling_power", // 0x1818
  CSC: "cycling_speed_and_cadence", // 0x1816
  FTMS: "fitness_machine", // 0x1826
};

const CHARACTERISTICS = {
  HRM_MEASUREMENT: "heart_rate_measurement", // 0x2a37
  POWER_MEASUREMENT: "cycling_power_measurement", // 0x2a63
  CSC_MEASUREMENT: "csc_measurement", // 0x2a5b
  INDOOR_BIKE_DATA: "indoor_bike_data", // 0x2ad2
  FTMS_CONTROL_POINT: "fitness_machine_control_point", // 0x2ad9
};

// Global Bluetooth State
const connections = {
  TRAINER: {
    device: null,
    server: null,
    charRead: null,
    charWrite: null,
    status: "DESCONECTADO",
    name: "",
    lastSentInclination: null,
    useSimulationParameters: true,
    isWritingSlope: false,
  },
  HRM: {
    device: null,
    server: null,
    charNotify: null,
    status: "DESCONECTADO",
    name: "",
  },
  POWER: {
    device: null,
    server: null,
    charNotify: null,
    status: "DESCONECTADO",
    name: "",
  },
  CSC: {
    device: null,
    server: null,
    charNotify: null,
    status: "DESCONECTADO",
    name: "",
  },
};

// Listeners
let dataListener = null;

// Virtual Simulator Settings
const simulator = {
  isActive: false,
  power: 150, // Watts
  cadence: 85, // RPM
  heartRate: 120, // BPM
  slope: 0.0, // %
  weight: 75, // kg
  intervalId: null,
};

function setBleListener(listener) {
  dataListener = listener;
}

/**
 * Decodes Heart Rate Measurement (0x2a37)
 */
function decodeHRM(dataView) {
  if (dataView.byteLength < 2) return;
  const flags = dataView.getUint8(0);
  const is16Bit = (flags & 0x01) !== 0;

  let hr = 0;
  if (is16Bit) {
    hr = dataView.getUint16(1, true);
  } else {
    hr = dataView.getUint8(1);
  }

  if (dataListener && dataListener.onHeartRateReceived) {
    dataListener.onHeartRateReceived(hr);
  }
}

/**
 * Decodes Cycling Power Measurement (0x2a63)
 */

function decodePower(dataView) {
  if (dataView.byteLength < 4) return;
  const flags = dataView.getUint16(0, true);
  let offset = 2;

  // Bit 0: Power (Instantaneous Power, sint16)
  // Bits 1-7: Other flags (Cumulative Wheel Revolutions, Last Wheel Event Time, etc.) - Ignored for now
  if ((flags & 0x01) !== 0) {
    if (dataView.byteLength >= offset + 2) {
      const power = dataView.getInt16(offset, true);
      offset += 2;
      if (dataListener && dataListener.onPowerReceived) {
        dataListener.onPowerReceived(power);
      }
    }
  }
  // TODO: Handle other flags like Cumulative Wheel Revolutions if needed by CSC decoding
}

/**
 * Decodes Cycling Speed & Cadence (0x2a5b)
 */
let lastWheelRevs = null;
let lastWheelTime = null;
let lastCrankRevs = null;
let lastCrankTime = null;

function decodeCSC(dataView) {
  if (dataView.byteLength < 1) return;
  const flags = dataView.getUint8(0);
  let offset = 1;

  // Bit 0: Wheel Revolution Data Present
  if ((flags & 0x01) !== 0) {
    if (dataView.byteLength >= offset + 6) {
      const wheelRevs = dataView.getUint32(offset, true);
      const wheelTime = dataView.getUint16(offset + 4, true); // 1/1024s
      offset += 6;

      if (lastWheelRevs !== null && lastWheelTime !== null) {
        let revsDiff = wheelRevs - lastWheelRevs;
        if (revsDiff < 0) revsDiff += 4294967296; // Handle uint32 rollover

        let timeDiff = wheelTime - lastWheelTime;
        if (timeDiff < 0) timeDiff += 65536; // Handle uint16 rollover

        if (timeDiff > 0 && revsDiff > 0) {
          const rps = revsDiff / (timeDiff / 1024.0);
          const wheelCircumference = 2.1; // meters (700x25c approx)
          const speedMps = rps * wheelCircumference;
          const speedKph = speedMps * 3.6;

          if (dataListener && dataListener.onSpeedReceived) {
            dataListener.onSpeedReceived(speedKph);
          }
        }
      }
      lastWheelRevs = wheelRevs;
      lastWheelTime = wheelTime;
    }
  }

  // Bit 1: Crank Revolution Data Present
  if ((flags & 0x02) !== 0) {
    if (dataView.byteLength >= offset + 4) {
      const crankRevs = dataView.getUint16(offset, true);
      const crankTime = dataView.getUint16(offset + 2, true); // 1/1024s

      if (lastCrankRevs !== null && lastCrankTime !== null) {
        let revsDiff = crankRevs - lastCrankRevs;
        if (revsDiff < 0) revsDiff += 65536;

        let timeDiff = crankTime - lastCrankTime;
        if (timeDiff < 0) timeDiff += 65536;

        if (timeDiff > 0 && revsDiff > 0) {
          const rpm = (revsDiff / (timeDiff / 1024.0)) * 60;
          if (dataListener && dataListener.onCadenceReceived) {
            dataListener.onCadenceReceived(Math.round(rpm));
          }
        }
      }
      lastCrankRevs = crankRevs;
      lastCrankTime = crankTime;
    }
  }
}

/**
 * Decodes Indoor Bike Data from Controllable Trainers (0x2ad2)
 */
function decodeIndoorBike(dataView) {
  if (dataView.byteLength < 2) return;
  const flags = dataView.getUint16(0, true);
  let offset = 2;

  // Bit 0: Speed (Present when "More Data" flag is 0, i.e. (flags & 0x01) === 0)
  if ((flags & 0x01) === 0) {
    if (dataView.byteLength >= offset + 2) {
      const speed = dataView.getUint16(offset, true) / 100.0;
      offset += 2;
      if (dataListener && dataListener.onSpeedReceived) {
        dataListener.onSpeedReceived(speed);
      }
    }
  }

  // Bit 1: Average Speed
  if ((flags & 0x02) !== 0) offset += 2;

  // Bit 2: Cadence (1=Present, uint16, 0.5 rpm)
  if ((flags & 0x04) !== 0) {
    if (dataView.byteLength >= offset + 2) {
      const cadence = dataView.getUint16(offset, true) * 0.5;
      offset += 2;
      if (dataListener && dataListener.onCadenceReceived) {
        dataListener.onCadenceReceived(Math.round(cadence));
      }
    }
  }

  // Bit 3: Average Cadence
  if ((flags & 0x08) !== 0) offset += 2;
  // Bit 4: Distance
  if ((flags & 0x10) !== 0) offset += 3;
  // Bit 5: Resistance Level
  if ((flags & 0x20) !== 0) offset += 2;

  // Bit 6: Power (1=Present, sint16, Watts)
  if ((flags & 0x40) !== 0) {
    if (dataView.byteLength >= offset + 2) {
      const power = dataView.getInt16(offset, true);
      if (dataListener && dataListener.onPowerReceived) {
        dataListener.onPowerReceived(power);
      }
    }
  }
}

/**
 * Decodes FTMS Control Point Response (0x2ad9)
 * OpCode 0x80 = Response Code
 * [0]: 0x80 (Response Code)
 * [1]: Request OpCode that this is responding to
 * [2]: Result Code (0x01 = Success, 0x02 = Op Code not supported, 0x03 = Invalid Parameter, 0x04 = Operation Failed, 0x05 = Control Not Permitted)
 */
function decodeFtmsControlResponse(dataView) {
  if (dataView.byteLength < 3) return;
  const responseCode = dataView.getUint8(0);
  if (responseCode !== 0x80) return; // Not a response opcode

  const requestOpCode = dataView.getUint8(1);
  const resultCode = dataView.getUint8(2);

  const opCodeNames = {
    0x00: "Request Control",
    0x03: "Set Target Inclination",
    0x05: "Set Target Resistance Level",
    0x07: "Start/Resume",
    0x08: "Stop/Pause",
    0x11: "Set Indoor Bike Simulation Parameters",
  };
  const resultNames = {
    0x01: "\u2705 Éxito",
    0x02: "\u274c OpCode no soportado",
    0x03: "\u274c Parámetro inválido",
    0x04: "\u274c Operación fallida",
    0x05: "\u274c Control no permitido",
  };

  const opName =
    opCodeNames[requestOpCode] ||
    `OpCode 0x${requestOpCode.toString(16).toUpperCase()}`;
  const resName =
    resultNames[resultCode] ||
    `Result 0x${resultCode.toString(16).toUpperCase()}`;

  if (resultCode === 0x01) {
    console.log(`[FTMS Response] ${opName} → ${resName}`);
  } else {
    console.warn(
      `[FTMS Response] ${opName} → ${resName} (código: 0x${resultCode.toString(16)})`,
    );

    // Fallback logic: if OpCode 0x11 fails on a smart trainer, switch to OpCode 0x03
    if (requestOpCode === 0x11 && connections.TRAINER.useSimulationParameters) {
      console.warn(
        "[FTMS Fallback] OpCode 0x11 rechazado. Intentando usar OpCode 0x03 (Set Target Inclination) en su lugar...",
      );
      connections.TRAINER.useSimulationParameters = false;
      connections.TRAINER.lastSentInclination = null;
    }
  }

  // Notificar al listener si existe
  if (dataListener && dataListener.onFtmsResponse) {
    dataListener.onFtmsResponse(requestOpCode, resultCode);
  }
}

/**
 * Configures the FTMS Control Point (0x2ad9) on connection or reconnection
 */
async function setupFtmsControlPoint(service, type) {
  console.log("[FTMS Setup] Buscando el punto de control FTMS (0x2ad9)...");

  // Diagnostic: List all characteristics in this service
  let characteristics = [];
  try {
    characteristics = await service.getCharacteristics();
    console.log(
      `[FTMS Setup] Características del servicio FTMS encontradas (${characteristics.length}):`,
    );
    for (const char of characteristics) {
      const props = char.properties;
      const propList = [];
      if (props.read) propList.push("READ");
      if (props.write) propList.push("WRITE");
      if (props.writeWithoutResponse) propList.push("WRITE_WITHOUT_RESPONSE");
      if (props.notify) propList.push("NOTIFY");
      if (props.indicate) propList.push("INDICATE");
      console.log(
        `  - UUID: ${char.uuid} | Propiedades: [${propList.join(", ")}]`,
      );
    }
  } catch (diagErr) {
    console.warn(
      "[FTMS Setup] No se pudo hacer el listado de diagnóstico de características:",
      diagErr,
    );
  }

  // Find the FTMS Control Point characteristic
  let charWrite = null;

  // Try 1: Try finding it in the scanned characteristics list (more robust)
  if (characteristics.length > 0) {
    charWrite = characteristics.find(
      (char) =>
        char.uuid === "00002ad9-0000-1000-8000-00805f9b34fb" ||
        char.uuid.toLowerCase().includes("2ad9"),
    );
  }

  // Try 2: Fallback to getCharacteristic if not found in list
  if (!charWrite) {
    console.log(
      "[FTMS Setup] Intentando getCharacteristic para FTMS_CONTROL_POINT...",
    );
    charWrite = await service.getCharacteristic(
      CHARACTERISTICS.FTMS_CONTROL_POINT,
    );
  }

  if (!charWrite) {
    throw new Error(
      "No se encontró la característica del Punto de Control FTMS (0x2ad9).",
    );
  }

  connections[type].charWrite = charWrite;
  connections[type].lastSentInclination = null; // Reset last sent inclination
  connections[type].useSimulationParameters = true; // Reset fallback on connection
  console.log(
    "[FTMS Setup] Característica del Punto de Control encontrada. Configurando...",
  );

  // Step 1: Subscribe to indications/notifications BEFORE requesting control.
  // This is required because writing 0x00 expects an indication response from the trainer.
  try {
    console.log(
      "[FTMS Setup] Suscribiendo a indicaciones del Control Point...",
    );
    await charWrite.startNotifications();
    charWrite.addEventListener("characteristicvaluechanged", (e) => {
      decodeFtmsControlResponse(e.target.value);
    });
    console.log(
      "[FTMS Setup] Suscripción exitosa a indicaciones del Control Point.",
    );
  } catch (notifyErr) {
    console.warn(
      "[FTMS Setup] Advertencia: No se pudo suscribir a indicaciones del Control Point (se continuará):",
      notifyErr,
    );
  }

  // Small delay to allow the BLE stack to register the CCCD subscription
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Step 2: Request Control (Write 0x00)
  console.log(
    "[FTMS Setup] Enviando comando de solicitud de control (0x00)...",
  );
  let writeSuccess = false;

  // Try writeValueWithResponse (modern Web Bluetooth)
  if (charWrite.writeValueWithResponse) {
    try {
      await charWrite.writeValueWithResponse(new Uint8Array([0x00]));
      console.log(
        "[FTMS Setup] Control solicitado con éxito (0x00 enviado via writeValueWithResponse)",
      );
      writeSuccess = true;
    } catch (writeErr) {
      console.warn(
        "[FTMS Setup] Falló writeValueWithResponse. Probando writeValue alternativo...",
        writeErr,
      );
    }
  }

  // Try legacy writeValue
  if (!writeSuccess) {
    try {
      await charWrite.writeValue(new Uint8Array([0x00]));
      console.log(
        "[FTMS Setup] Control solicitado con éxito (0x00 enviado via writeValue)",
      );
      writeSuccess = true;
    } catch (writeErr) {
      console.error("[FTMS Setup] Falló también writeValue:", writeErr);
      throw writeErr;
    }
  }
}

/**
 * Connect to a BLE Device
 */
async function connectDevice(type) {
  if (!navigator.bluetooth) {
    throw new Error(
      "Web Bluetooth no está soportado en este navegador o requiere HTTPS/localhost.",
    );
  }

  let serviceUuid,
    charUuid,
    isTrainer = false;
  switch (type) {
    case "TRAINER":
      serviceUuid = SERVICES.FTMS;
      isTrainer = true;
      break;
    case "HRM":
      serviceUuid = SERVICES.HRM;
      charUuid = CHARACTERISTICS.HRM_MEASUREMENT;
      break;
    case "POWER":
      serviceUuid = SERVICES.POWER;
      charUuid = CHARACTERISTICS.POWER_MEASUREMENT;
      break;
    case "CSC":
      serviceUuid = SERVICES.CSC;
      charUuid = CHARACTERISTICS.CSC_MEASUREMENT;
      break;
    default:
      throw new Error("Tipo de sensor no reconocido.");
  }

  try {
    isDisconnectingIntentionally = false;
    updateStatus(type, "BUSCANDO");

    // Request device
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [serviceUuid] }],
      optionalServices: isTrainer ? [SERVICES.FTMS] : [],
    });

    updateStatus(type, "CONECTANDO");

    // Connect to GATT with a 12-second timeout
    let server;
    try {
      const connectPromise = device.gatt.connect();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT")), 12000),
      );
      server = await Promise.race([connectPromise, timeoutPromise]);
    } catch (err) {
      if (err.message === "TIMEOUT") {
        try {
          device.gatt.disconnect();
        } catch (_) {}
        throw new Error(
          "Tiempo de espera de conexión Bluetooth agotado (12s).",
        );
      }
      throw err;
    }

    // Discover service with retry logic
    let service;
    let retries = 3;
    while (retries > 0) {
      try {
        service = await server.getPrimaryService(serviceUuid);
        break;
      } catch (err) {
        retries--;
        if (retries === 0)
          throw new Error(
            `No se pudo descubrir el servicio después de 3 intentos: ${err.message}`,
          );
        await new Promise((resolve) => setTimeout(resolve, 500)); // wait 500ms before retry
      }
    }

    connections[type].device = device;
    connections[type].server = server;
    connections[type].name = device.name || "Dispositivo Bluetooth";

    // Handle Disconnections
    device.addEventListener("gattserverdisconnected", () => {
      handleDisconnect(type);
    });

    if (isTrainer) {
      // FTMS setup
      const charRead = await service.getCharacteristic(
        CHARACTERISTICS.INDOOR_BIKE_DATA,
      );
      connections[type].charRead = charRead;

      // Start notifications for FTMS Indoor Bike Data
      await charRead.startNotifications();
      charRead.addEventListener("characteristicvaluechanged", (e) => {
        decodeIndoorBike(e.target.value);
      });

      try {
        await setupFtmsControlPoint(service, type);
      } catch (controlError) {
        console.warn(
          "El punto de control FTMS no está disponible o falló la solicitud, conectando en modo de solo lectura:",
          controlError,
        );
        connections[type].charWrite = null;
      }
    } else {
      // General notify sensor setup
      const charNotify = await service.getCharacteristic(charUuid);
      connections[type].charNotify = charNotify;

      await charNotify.startNotifications();
      charNotify.addEventListener("characteristicvaluechanged", (e) => {
        if (type === "HRM") decodeHRM(e.target.value);
        if (type === "POWER") decodePower(e.target.value);
        if (type === "CSC") decodeCSC(e.target.value);
      });
    }

    updateStatus(type, "CONECTADO");
    return connections[type].name;
  } catch (error) {
    console.error(`Error connecting to ${type}:`, error);
    updateStatus(type, "DESCONECTADO");
    throw error;
  }
}

let isDisconnectingIntentionally = false;
const reconnectAttempts = {
  TRAINER: 0,
  HRM: 0,
  POWER: 0,
  CSC: 0,
};
const MAX_RECONNECT_ATTEMPTS = 3;

async function attemptAutoReconnect(type, device) {
  if (reconnectAttempts[type] >= MAX_RECONNECT_ATTEMPTS) {
    console.error(
      `Reconexión automática fallida para ${type} tras ${MAX_RECONNECT_ATTEMPTS} intentos.`,
    );
    reconnectAttempts[type] = 0;
    connections[type].device = null;
    connections[type].name = "";
    updateStatus(type, "DESCONECTADO");
    return;
  }

  reconnectAttempts[type]++;
  updateStatus(type, "CONECTANDO");
  console.log(
    `[Auto-Reconnect] Intentando reconectar ${type} (Intento ${reconnectAttempts[type]}/${MAX_RECONNECT_ATTEMPTS})...`,
  );

  try {
    // Wait 2 seconds before retry
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Connect to GATT with a 12-second timeout
    let server;
    try {
      const connectPromise = device.gatt.connect();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT")), 12000),
      );
      server = await Promise.race([connectPromise, timeoutPromise]);
    } catch (err) {
      if (err.message === "TIMEOUT") {
        try {
          device.gatt.disconnect();
        } catch (_) {}
        throw new Error("TIMEOUT");
      }
      throw err;
    }

    let serviceUuid = SERVICES.FTMS;
    if (type === "HRM") serviceUuid = SERVICES.HRM;
    if (type === "POWER") serviceUuid = SERVICES.POWER;
    if (type === "CSC") serviceUuid = SERVICES.CSC;

    const service = await server.getPrimaryService(serviceUuid);
    connections[type].server = server;

    if (type === "TRAINER") {
      const charRead = await service.getCharacteristic(
        CHARACTERISTICS.INDOOR_BIKE_DATA,
      );
      connections[type].charRead = charRead;

      await charRead.startNotifications();
      charRead.addEventListener("characteristicvaluechanged", (e) => {
        decodeIndoorBike(e.target.value);
      });

      try {
        await setupFtmsControlPoint(service, type);
      } catch (controlError) {
        console.warn(
          "[FTMS Reconex.] El punto de control FTMS falló durante la reconexión:",
          controlError,
        );
        connections[type].charWrite = null;
      }
    } else {
      let charUuid = CHARACTERISTICS.HRM_MEASUREMENT;
      if (type === "POWER") charUuid = CHARACTERISTICS.POWER_MEASUREMENT;
      if (type === "CSC") charUuid = CHARACTERISTICS.CSC_MEASUREMENT;

      const charNotify = await service.getCharacteristic(charUuid);
      connections[type].charNotify = charNotify;

      await charNotify.startNotifications();
      charNotify.addEventListener("characteristicvaluechanged", (e) => {
        if (type === "HRM") decodeHRM(e.target.value);
        if (type === "POWER") decodePower(e.target.value);
        if (type === "CSC") decodeCSC(e.target.value);
      });
    }

    reconnectAttempts[type] = 0;
    updateStatus(type, "CONECTADO");
    console.log(`[Auto-Reconnect] ${type} reconectado con éxito.`);
  } catch (error) {
    console.warn(
      `[Auto-Reconnect] Fallo en intento ${reconnectAttempts[type]} para ${type}:`,
      error,
    );
    attemptAutoReconnect(type, device);
  }
}

function handleDisconnect(type) {
  console.warn(`Dispositivo de tipo ${type} desconectado.`);

  const conn = connections[type];
  const device = conn.device;

  conn.server = null;
  conn.charRead = null;
  conn.charWrite = null;
  conn.charNotify = null;
  if (type === "TRAINER") {
    conn.lastSentInclination = null;
  }

  if (isDisconnectingIntentionally || !device) {
    conn.device = null;
    conn.name = "";
    updateStatus(type, "DESCONECTADO");
  } else {
    attemptAutoReconnect(type, device);
  }
}

function updateStatus(type, status) {
  connections[type].status = status;
  if (dataListener && dataListener.onStatusChanged) {
    dataListener.onStatusChanged(type, status);
  }

  // Si se conecta/desconecta el rodillo interactivo, sincronizamos también potenciómetro y cadencia en la interfaz
  if (type === "TRAINER" && !simulator.isActive) {
    if (status === "CONECTADO") {
      const trainerName = connections.TRAINER.name || "Rodillo Inteligente";

      if (connections.POWER.status !== "CONECTADO") {
        connections.POWER.status = "CONECTADO";
        connections.POWER.name = `${trainerName} (Vía Rodillo)`;
        if (dataListener && dataListener.onStatusChanged) {
          dataListener.onStatusChanged("POWER", "CONECTADO");
        }
      }

      if (connections.CSC.status !== "CONECTADO") {
        connections.CSC.status = "CONECTADO";
        connections.CSC.name = `${trainerName} (Vía Rodillo)`;
        if (dataListener && dataListener.onStatusChanged) {
          dataListener.onStatusChanged("CSC", "CONECTADO");
        }
      }
    } else if (status === "DESCONECTADO") {
      // Solo desconectamos automáticamente si estaban vinculados virtualmente (su dispositivo físico es nulo)
      if (
        connections.POWER.status === "CONECTADO" &&
        connections.POWER.device === null
      ) {
        connections.POWER.status = "DESCONECTADO";
        connections.POWER.name = "";
        if (dataListener && dataListener.onStatusChanged) {
          dataListener.onStatusChanged("POWER", "DESCONECTADO");
        }
      }

      if (
        connections.CSC.status === "CONECTADO" &&
        connections.CSC.device === null
      ) {
        connections.CSC.status = "DESCONECTADO";
        connections.CSC.name = "";
        if (dataListener && dataListener.onStatusChanged) {
          dataListener.onStatusChanged("CSC", "DESCONECTADO");
        }
      }
    }
  }
}

function disconnectDevice(type) {
  isDisconnectingIntentionally = true;
  const conn = connections[type];
  if (conn.device && conn.device.gatt.connected) {
    conn.device.gatt.disconnect();
  }
  handleDisconnect(type);
}

async function disconnectAll() {
  stopSimulator();
  isDisconnectingIntentionally = true;
  for (const type in connections) {
    if (connections[type].device && connections[type].device.gatt.connected) {
      connections[type].device.gatt.disconnect();
    }
    handleDisconnect(type);
  }
}

/**
 * Write Target Inclination (Slope) to Controllable FTMS Smart Trainer
 * Inclination represented as short (sint16), unit is 0.1%
 */
async function setTrainerSlope(slope) {
  // Aplicar factor de realismo/dureza (del 30% al 150%)
  const realismFactor =
    state.realismFactor !== undefined ? state.realismFactor : 1.0;
  const adjustedSlope = slope * realismFactor;

  if (simulator.isActive) {
    simulator.slope = adjustedSlope;
    return;
  }

  const trainer = connections.TRAINER;
  if (trainer.status === "CONECTADO" && trainer.charWrite) {
    if (trainer.isWritingSlope) {
      // Evitar colisiones GATT si ya hay una operación en curso
      return;
    }

    try {
      trainer.isWritingSlope = true;
      // Clamped to standard -15.0% to +20.0%
      const clampedSlope = Math.max(-15.0, Math.min(20.0, adjustedSlope));

      if (trainer.useSimulationParameters === undefined) {
        trainer.useSimulationParameters = false; // Forzamos el uso de OpCode 0x03
      }

      if (trainer.useSimulationParameters) {
        // OpCode 0x11: Set Indoor Bike Simulation Parameters
        // Grade resolution is 0.01%
        const inclination = Math.round(clampedSlope * 100);

        // Deduplicar: no enviar si la inclinación es la misma que la anterior
        if (trainer.lastSentInclination === inclination) {
          return;
        }

        // Build 7-byte buffer
        const buffer = new ArrayBuffer(7);
        const view = new DataView(buffer);
        view.setUint8(0, 0x11);
        view.setInt16(1, 0, true); // Wind Speed = 0 m/s
        view.setInt16(3, inclination, true); // Grade in 0.01%
        view.setUint8(5, 33); // Crr = 0.0033 (scaled by 10000 = 33)
        view.setUint8(6, 51); // Cw = 0.51 kg/m (scaled by 100 = 51)

        await trainer.charWrite.writeValue(buffer);
        trainer.lastSentInclination = inclination;
        console.log(
          `[FTMS → Rodillo] Set Inclination (OpCode 0x11): ${clampedSlope.toFixed(2)}% (valor bruto: ${inclination}) enviado correctamente`,
        );
      } else {
        // OpCode 0x03: Set Target Inclination
        // Grade resolution is 0.1%
        const inclination = Math.round(clampedSlope * 10);

        // Deduplicar: no enviar si la inclinación es la misma que la anterior
        if (trainer.lastSentInclination === inclination) {
          return;
        }

        // Build 3-byte buffer
        const buffer = new ArrayBuffer(3);
        const view = new DataView(buffer);
        view.setUint8(0, 0x03);
        view.setInt16(1, inclination, true); // Little endian

        await trainer.charWrite.writeValue(buffer);
        trainer.lastSentInclination = inclination;
        console.log(
          `[FTMS → Rodillo] Set Inclination (OpCode 0x03): ${clampedSlope.toFixed(1)}% (valor bruto: ${inclination}) enviado correctamente`,
        );
      }
    } catch (e) {
      console.error("[FTMS → Rodillo] Error al enviar pendiente:", e);
    } finally {
      trainer.isWritingSlope = false;
    }
  } else {
    if (trainer.status !== "CONECTADO") {
      console.warn(
        `[FTMS] No se envía pendiente: rodillo en estado '${trainer.status}'`,
      );
    } else if (!trainer.charWrite) {
      console.warn(
        "[FTMS] No se envía pendiente: charWrite no disponible (modo solo lectura o sin FTMS Control Point)",
      );
    }
  }
}

// --- PHYSICS ENGINE FOR SIMULATED OR SENSOR LACK workouts ---
/**
 * Calculates virtual speed (km/h) based on Power (W) and Slope (%)
 * Formulas based on cycling power physics (gravity, rolling resistance, air drag)
 */
function calculateVirtualSpeed(power, slope, userWeight = 75.0) {
  if (power <= 0) return 0.0;

  const bikeWeight = 10.0; // kg
  const totalMass = userWeight + bikeWeight;
  const g = 9.81; // m/s^2

  // Resistance Coefficients
  const Crr = 0.005; // Rolling resistance (good asphalt)
  const CdA = 0.32; // Aero drag coefficient (standard road cyclist hoods)
  const rho = 1.225; // Air density at sea level (kg/m^3)

  // Slopes in radians approx
  const slopeDecimal = slope / 100.0;

  // Power = P_gravity + P_rolling + P_air
  // We want to solve for speed V (m/s) in:
  // Power = [totalMass * g * slopeDecimal * V] + [totalMass * g * Crr * V] + [0.5 * CdA * rho * V^3]
  // We use numerical root-finding (Newton-Raphson) to find V:

  let v = 5.0; // Initial guess: 18 km/h (5 m/s)
  const tolerance = 0.01;
  const maxIterations = 20;

  for (let i = 0; i < maxIterations; i++) {
    // f(v) = 0.5 * CdA * rho * v^3 + totalMass * g * (slopeDecimal + Crr) * v - Power
    // We coerce slopeDecimal + Crr to not let V go negative in steep downhills without pedaling
    const rollingGravityFactor =
      totalMass * g * Math.max(-0.08, slopeDecimal + Crr);

    const f_v =
      0.5 * CdA * rho * Math.pow(v, 3) + rollingGravityFactor * v - power;
    const f_prime_v = 1.5 * CdA * rho * Math.pow(v, 2) + rollingGravityFactor;

    if (Math.abs(f_prime_v) < 0.0001) break;

    const next_v = v - f_v / f_prime_v;
    if (Math.abs(next_v - v) < tolerance) {
      v = next_v;
      break;
    }
    v = next_v;
  }

  // Clamped between 0 and 80 km/h
  const speedMps = Math.max(0.0, Math.min(22.2, v));
  const speedKph = speedMps * 3.6;
  return isNaN(speedKph) ? 0.0 : speedKph;
}

// --- VIRTUAL SENSOR SIMULATOR ---
function startSimulator(userWeight = 75.0) {
  if (simulator.isActive) return;

  simulator.isActive = true;
  simulator.weight = Number(userWeight) || 75.0;

  // Dispatch status updates for simulator (only for trainer, power, AND CSC)
  updateStatus("TRAINER", "CONECTADO");
  updateStatus("POWER", "CONECTADO");
  updateStatus("CSC", "CONECTADO");

  connections.TRAINER.name = "Rodillo Virtual";
  connections.POWER.name = "Potenciómetro Virtual";
  connections.CSC.name = "Velocidad/Cadencia Virtual";

  simulator.intervalId = setInterval(() => {
    if (!simulator.isActive) return;

    // Simulate cadences with minor jitter
    const cadJitter = Math.floor(Math.random() * 5) - 2;
    const currentCad = Math.max(
      60,
      Math.min(110, simulator.cadence + cadJitter),
    );

    // Simulate Heart Rate with minor jitter
    const hrJitter = Math.floor(Math.random() * 3) - 1;
    const currentHr = Math.max(
      70,
      Math.min(190, simulator.heartRate + hrJitter),
    );

    // Calculate Speed based on physics
    const currentSpeed = calculateVirtualSpeed(
      simulator.power,
      simulator.slope,
      simulator.weight,
    );

    // Callbacks
    if (dataListener) {
      if (dataListener.onPowerReceived)
        dataListener.onPowerReceived(simulator.power);
      if (dataListener.onCadenceReceived)
        dataListener.onCadenceReceived(currentCad);
      if (dataListener.onHeartRateReceived)
        dataListener.onHeartRateReceived(currentHr);
      if (dataListener.onSpeedReceived)
        dataListener.onSpeedReceived(currentSpeed);
    }
  }, 1000);

  console.log("Virtual Sensor Simulator started");
}

function stopSimulator() {
  if (!simulator.isActive) return;

  simulator.isActive = false;
  if (simulator.intervalId) {
    clearInterval(simulator.intervalId);
    simulator.intervalId = null;
  }

  console.log("Virtual Sensor Simulator stopped");
}

function setSimulatedMetrics(power, hr, cadence) {
  if (power !== undefined) simulator.power = Number(power);
  if (hr !== undefined) simulator.heartRate = Number(hr);
  if (cadence !== undefined) simulator.cadence = Number(cadence);
}

/**
 * Intenta reconectar silenciosamente a dispositivos vinculados anteriormente sin mostrar el selector.
 */
async function autoReconnectSavedDevices() {
  if (!navigator.bluetooth || !navigator.bluetooth.getDevices) {
    console.log(
      "[Auto-Reconnect] El navegador no soporta navigator.bluetooth.getDevices()",
    );
    return;
  }

  try {
    const devices = await navigator.bluetooth.getDevices();
    if (devices.length === 0) {
      console.log(
        "[Auto-Reconnect] No hay dispositivos aprobados previamente en este navegador.",
      );
      return;
    }

    const lastTrainerName = localStorage.getItem("rodilloint_lastTrainerName");
    const lastHrmName = localStorage.getItem("rodilloint_lastHrmName");

    console.log(
      `[Auto-Reconnect] getDevices() devolvió ${devices.length} dispositivos. Buscando coincidencias...`,
    );

    for (const device of devices) {
      if (
        lastTrainerName &&
        device.name === lastTrainerName &&
        connections.TRAINER.status === "DESCONECTADO"
      ) {
        console.log(
          `[Auto-Reconnect] Coincidencia: Rodillo "${device.name}". Conectando...`,
        );
        silenceConnect(device, "TRAINER");
      }
      if (
        lastHrmName &&
        device.name === lastHrmName &&
        connections.HRM.status === "DESCONECTADO"
      ) {
        console.log(
          `[Auto-Reconnect] Coincidencia: Pulsómetro "${device.name}". Conectando...`,
        );
        silenceConnect(device, "HRM");
      }
    }
  } catch (err) {
    console.warn(
      "[Auto-Reconnect] Error al obtener dispositivos pre-vinculados:",
      err,
    );
  }
}

/**
 * Conecta a un dispositivo bluetooth ya obtenido sin usar requestDevice()
 */
async function silenceConnect(device, type) {
  let serviceUuid,
    isTrainer = false;
  switch (type) {
    case "TRAINER":
      serviceUuid = SERVICES.FTMS;
      isTrainer = true;
      break;
    case "HRM":
      serviceUuid = SERVICES.HRM;
      break;
    default:
      return;
  }

  try {
    isDisconnectingIntentionally = false;
    updateStatus(type, "CONECTANDO");

    // Conectar GATT con timeout
    let server;
    try {
      const connectPromise = device.gatt.connect();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT")), 12000),
      );
      server = await Promise.race([connectPromise, timeoutPromise]);
    } catch (err) {
      if (err.message === "TIMEOUT") {
        try {
          device.gatt.disconnect();
        } catch (_) {}
      }
      throw err;
    }

    const service = await server.getPrimaryService(serviceUuid);

    connections[type].device = device;
    connections[type].server = server;
    connections[type].name = device.name || "Dispositivo Bluetooth";

    device.addEventListener("gattserverdisconnected", () => {
      handleDisconnect(type);
    });

    if (isTrainer) {
      const charRead = await service.getCharacteristic(
        CHARACTERISTICS.INDOOR_BIKE_DATA,
      );
      connections[type].charRead = charRead;

      await charRead.startNotifications();
      charRead.addEventListener("characteristicvaluechanged", (e) => {
        decodeIndoorBike(e.target.value);
      });

      try {
        await setupFtmsControlPoint(service, type);
      } catch (controlError) {
        console.warn(
          "[FTMS Silence] El punto de control FTMS falló al autoconectar:",
          controlError,
        );
        connections[type].charWrite = null;
      }
    } else {
      let charUuid = CHARACTERISTICS.HRM_MEASUREMENT;
      const charNotify = await service.getCharacteristic(charUuid);
      connections[type].charNotify = charNotify;

      await charNotify.startNotifications();
      charNotify.addEventListener("characteristicvaluechanged", (e) => {
        if (type === "HRM") decodeHRM(e.target.value);
      });
    }

    updateStatus(type, "CONECTADO");
    console.log(
      `[Auto-Reconnect] Conectado exitosamente (silencioso) a ${type}: ${device.name}`,
    );
  } catch (error) {
    console.error(
      `[Auto-Reconnect] Error al autoconectar silenciosamente a ${type}:`,
      error,
    );
    updateStatus(type, "DESCONECTADO");
  }
}

// Export Bluetooth Manager globally
window.BleManager = {
  connections,
  setBleListener,
  connectDevice,
  disconnectAll,
  setTrainerSlope,
  calculateVirtualSpeed,
  autoReconnectSavedDevices,
  startSimulator,
  stopSimulator,
  setSimulatedMetrics,
  simulator,
};
