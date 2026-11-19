\# Plan de Implementación: Soporte de Entrenamientos (ERG, ZWO, TrainingPeaks y Editor Web)
q


\## 1. Objetivos del Módulo

\- Permitir la importación de archivos de entrenamiento externos (`.zwo`, `.erg`, `.mrc`).

\- Permitir la creación y edición visual de entrenamientos personalizados dentro de la app web ("Workout Builder").

\- Visualizar el perfil gráfico de potencia del entrenamiento antes y durante la sesión.

\- Preparar la estructura de datos para la ejecución en modo ERG con rodillos inteligentes vía Web Bluetooth (FTMS).



\---



\## 2. Estructura de Datos Unificada (Modelo de Entrenamiento)

Independientemente de si el entrenamiento viene de un `.zwo`, un `.erg` o se crea en la app, se mapeará a una estructura JSON común en TypeScript:



```ts

export type WorkoutStepType = 'warmup' | 'steady' | 'interval' | 'ramp' | 'cooldown';



export interface WorkoutStep {

\&#x20; id: string;

\&#x20; type: WorkoutStepType;

\&#x20; durationSeconds: number;

\&#x20; powerStart: number; // Porcentaje de FTP (ej: 0.6 = 60%) o vatios absolutos

\&#x20; powerEnd?: number;  // Usado para rampas o intervalos variables

\&#x20; cadence?: number;   // Cadencia objetivo opcional

\&#x20; text?: string;      // Mensaje de texto a mostrar en pantalla durante el bloque

}



export interface Workout {

\&#x20; id: string;

\&#x20; name: string;

\&#x20; description: string;

\&#x20; author?: string;

\&#x20; totalDurationSeconds: number;

\&#x20; steps: WorkoutStep\\\[];

}




