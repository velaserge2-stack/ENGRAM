/** Entrada de la bóveda. Las rutas siempre son relativas a la raíz, con "/" y sin "/" inicial. */
export interface FileStat {
  path: string;
  name: string;
  kind: 'file' | 'dir';
  size: number;
  /** ms epoch; 0 si el backend no lo sabe (directorios). */
  mtime: number;
}

/**
 * Interfaz única de almacenamiento (SPEC §3). La app solo habla con esto;
 * OPFS, carpeta real (File System Access) o memoria son intercambiables.
 */
export interface VaultAdapter {
  readonly kind: 'opfs' | 'fsaccess' | 'memory';
  /** Hijos directos de un directorio ("" = raíz). Lista vacía si no existe. */
  list(path: string): Promise<FileStat[]>;
  read(path: string): Promise<Uint8Array>;
  /** Crea directorios intermedios. Sobrescribe. */
  write(path: string, data: Uint8Array | string): Promise<void>;
  /** Archivo o directorio (recursivo). No falla si no existe. */
  remove(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileStat | null>;
}

export class VaultError extends Error {
  constructor(
    message: string,
    readonly code: 'not-found' | 'invalid-path' | 'io' | 'unsupported',
    readonly path?: string,
  ) {
    super(message);
    this.name = 'VaultError';
  }
}
