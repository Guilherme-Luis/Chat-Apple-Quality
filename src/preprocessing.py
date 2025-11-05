#!/usr/bin/env python3
"""
Preprocessing pipeline for apple_quality.csv

Steps implemented (seguindo o Pre_processamento.ipynb):
1. Carrega CSV
2. Remove colunas irrelevantes (ex: A_id)
3. Detecta e trata valores ausentes (numéricos -> mediana; categóricos -> moda)
4. Remove duplicatas
5. Detecta e remove outliers (método IQR, opcional)
6. Codifica rótulo Quality (usa mapping se for 'good'/'bad', senão LabelEncoder)
7. Escala atributos numéricos (StandardScaler)
8. Salva CSV/JSON procesados, artefatos (scaler/encoder) e plots (correlação)
9. Logs de cada etapa
"""
import argparse
import os
import json
import logging
from typing import Optional, Tuple, List, Dict

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')  # backend não-interativo (salva imagens sem display)
import matplotlib.pyplot as plt
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.preprocessing import StandardScaler, LabelEncoder
import joblib

# --- Configuração de logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("preprocessing")

# --- Funções utilitárias
def ensure_dir(path: str):
    if not os.path.exists(path):
        os.makedirs(path, exist_ok=True)

def load_csv(path: str, index_col: Optional[str] = None) -> pd.DataFrame:
    logger.info(f"Carregando CSV: {path}")
    df = pd.read_csv(path)
    logger.info(f"Shape inicial: {df.shape}")
    return df

def drop_irrelevant(df: pd.DataFrame, drop_cols: List[str]) -> pd.DataFrame:
    present = [c for c in drop_cols if c in df.columns]
    if present:
        logger.info(f"Removendo colunas irrelevantes: {present}")
        df = df.drop(columns=present)
    else:
        logger.info("Nenhuma coluna irrelevante encontrada para remoção.")
    return df

def report_missing(df: pd.DataFrame) -> pd.Series:
    miss = df.isnull().sum()
    miss = miss[miss > 0].sort_values(ascending=False)
    if not miss.empty:
        logger.info("Colunas com valores ausentes:\n" + miss.to_string())
    else:
        logger.info("Nenhum valor ausente encontrado.")
    return miss

def impute_missing(df: pd.DataFrame) -> pd.DataFrame:
    num_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    cat_cols = df.select_dtypes(include=['object', 'category']).columns.tolist()

    for c in num_cols:
        if df[c].isnull().any():
            med = df[c].median()
            df[c] = df[c].fillna(med)
            logger.info(f"Imputado NaN na coluna numérica '{c}' com mediana={med}")

    for c in cat_cols:
        if df[c].isnull().any():
            mode = df[c].mode()
            if not mode.empty:
                m = mode.iloc[0]
                df[c] = df[c].fillna(m)
                logger.info(f"Imputado NaN na coluna categórica '{c}' com moda='{m}'")
            else:
                df[c] = df[c].fillna("unknown")
                logger.info(f"Imputado NaN na coluna categórica '{c}' com 'unknown'")

    return df

def remove_duplicates(df: pd.DataFrame) -> Tuple[pd.DataFrame, int]:
    before = df.shape[0]
    df = df.drop_duplicates()
    after = df.shape[0]
    removed = before - after
    logger.info(f"Duplicatas removidas: {removed}")
    return df, removed

def detect_outliers_iqr(df: pd.DataFrame, numeric_cols: List[str], k: float = 1.5) -> pd.Series:
    # retorna boolean mask das linhas que são outliers em qualquer coluna numérica
    mask = pd.Series(False, index=df.index)
    for c in numeric_cols:
        q1 = df[c].quantile(0.25)
        q3 = df[c].quantile(0.75)
        iqr = q3 - q1
        lower = q1 - k * iqr
        upper = q3 + k * iqr
        col_mask = (df[c] < lower) | (df[c] > upper)
        mask = mask | col_mask
        logger.debug(f"Outliers em '{c}': {col_mask.sum()} (limites [{lower}, {upper}])")
    logger.info(f"Total de linhas com outliers detectados (qualquer coluna): {mask.sum()}")
    return mask

def remove_outliers(df: pd.DataFrame, numeric_cols: List[str], k: float = 1.5) -> Tuple[pd.DataFrame, int]:
    mask = detect_outliers_iqr(df, numeric_cols, k)
    before = df.shape[0]
    df_clean = df.loc[~mask].copy()
    after = df_clean.shape[0]
    removed = before - after
    logger.info(f"Linhas removidas por outliers: {removed}")
    return df_clean, removed

def compute_and_save_correlation_plot(df: pd.DataFrame, out_path: str):
    ensure_dir(os.path.dirname(out_path))
    num = df.select_dtypes(include=[np.number])
    if num.shape[1] < 2:
        logger.info("Não há colunas numéricas suficientes para gerar correlação.")
        return
    corr = num.corr()
    plt.figure(figsize=(10, 8))
    sns.heatmap(corr, annot=True, fmt=".2f", cmap="coolwarm", square=True)
    plt.title("Correlation matrix")
    plt.tight_layout()
    plt.savefig(out_path)
    plt.close()
    logger.info(f"Salvo plot de correlação em: {out_path}")

def encode_quality(df: pd.DataFrame, label_col: str = "Quality") -> Tuple[pd.DataFrame, object]:
    if label_col not in df.columns:
        raise ValueError(f"Coluna de rótulo '{label_col}' não encontrada no dataframe.")
    labels = df[label_col].unique().tolist()
    logger.info(f"Rótulos detectados em '{label_col}': {labels}")

    # Se forem exatamente ['good','bad'] (ou com ordem invertida), aplicar mapping consistente
    lowered = [str(x).lower() for x in labels]
    if set(lowered) == {"good", "bad"}:
        mapping = { 'good': 1, 'bad': 0 }
        df[label_col + "_encoded"] = df[label_col].str.lower().map(mapping)
        encoder = mapping
        logger.info("Usado mapping explícito {'good':1,'bad':0} para codificação do rótulo.")
    else:
        le = LabelEncoder()
        df[label_col + "_encoded"] = le.fit_transform(df[label_col].astype(str))
        encoder = le
        logger.info(f"LabelEncoder usado. Classes: {list(le.classes_)}")

    return df, encoder

def scale_numeric(df: pd.DataFrame, exclude_cols: List[str] = None) -> Tuple[pd.DataFrame, StandardScaler, List[str]]:
    if exclude_cols is None:
        exclude_cols = []

    num_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    # não escalar coluna de label codificado (ex: Quality_encoded) se presente
    cols_to_scale = [c for c in num_cols if c not in exclude_cols]
    logger.info(f"Colunas a serem escaladas: {cols_to_scale}")

    scaler = StandardScaler()
    if cols_to_scale:
        df_scaled = df.copy()
        df_scaled[cols_to_scale] = scaler.fit_transform(df_scaled[cols_to_scale])
        logger.info("Escalonamento padrão (StandardScaler) aplicado.")
    else:
        df_scaled = df.copy()
        logger.info("Nenhuma coluna numérica a ser escalada.")

    return df_scaled, scaler, cols_to_scale

def save_artifacts(df: pd.DataFrame, out_csv: str, out_json: str,
                   plots_dir: str, artifacts_dir: str,
                   scaler: Optional[StandardScaler], encoder: Optional[object]):
    ensure_dir(os.path.dirname(out_csv))
    ensure_dir(os.path.dirname(out_json))
    ensure_dir(plots_dir)
    ensure_dir(artifacts_dir)

    df.to_csv(out_csv, index=False)
    logger.info(f"CSV processado salvo em: {out_csv}")

    # JSON: converter para orient records para consistência com frontends JS
    df.to_json(out_json, orient="records", force_ascii=False)
    logger.info(f"JSON processado salvo em: {out_json}")

    # salvar artefatos
    if scaler is not None:
        scaler_path = os.path.join(artifacts_dir, "scaler.joblib")
        joblib.dump(scaler, scaler_path)
        logger.info(f"Scaler salvo em: {scaler_path}")
    if encoder is not None:
        encoder_path = os.path.join(artifacts_dir, "label_encoder.joblib")
        # encoder pode ser dict (mapping) ou sklearn encoder
        joblib.dump(encoder, encoder_path)
        logger.info(f"Encoder salvo em: {encoder_path}")

def main(args):
    # Paths
    input_csv = args.input
    out_dir = args.out_dir
    ensure_dir(out_dir)
    plots_dir = os.path.join(out_dir, "plots")
    artifacts_dir = os.path.join(out_dir, "artifacts")
    out_csv = os.path.join(out_dir, "processed_apple_quality.csv")
    out_json = os.path.join(out_dir, "processed_apple_quality.json")
    corr_plot_path = os.path.join(plots_dir, "correlation.png")

    # Load
    df = load_csv(input_csv)

    # Drop irrelevant cols
    df = drop_irrelevant(df, args.drop_cols)

    # Missing
    report_missing(df)
    df = impute_missing(df)

    # Duplicates
    df, removed_dup = remove_duplicates(df)

    # Outliers (opcional)
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    logger.info(f"Colunas numéricas detectadas: {numeric_cols}")

    if args.remove_outliers and numeric_cols:
        df_before = df.copy()
        df, removed_out = remove_outliers(df, numeric_cols, k=args.iqr_k)
        logger.info(f"Removed {removed_out} rows as outliers (IQR k={args.iqr_k}).")
    else:
        logger.info("Remoção de outliers desabilitada ou sem colunas numéricas.")

    # Correlation plot (usamos df atual)
    compute_and_save_correlation_plot(df, corr_plot_path)

    # Encode label
    df, encoder = encode_quality(df, label_col=args.label_col)

    # Scale numeric (excluir coluna de label codificado)
    exclude = [args.label_col + "_encoded"]
    df_scaled, scaler, scaled_cols = scale_numeric(df, exclude_cols=exclude)

    # Salvar artefatos e dados
    save_artifacts(df_scaled, out_csv, out_json, plots_dir, artifacts_dir, scaler, encoder)

    logger.info("Pré-processamento concluído.")
    logger.info(f"Output CSV: {out_csv}")
    logger.info(f"Output JSON: {out_json}")
    logger.info(f"Plots: {plots_dir}")
    logger.info(f"Artefatos: {artifacts_dir}")
    
    try:
        sample_n = 50
        records = df_scaled.head(sample_n).to_dict(orient='records')
        result = {
            "status": "sucesso",
            "rows_total": int(df_scaled.shape[0]),
            "sample_count": len(records),
            "data_sample": records
        }
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        logger.exception("Falha ao serializar resultado para stdout")
        raise

if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Apple quality preprocessing pipeline")
    p.add_argument("--input", "-i", required=False, default="resources/apple_quality.csv",
                   help="Caminho para o CSV de entrada (default: resources/apple_quality.csv)")
    p.add_argument("--out-dir", "-o", required=False, default="resources",
                   help="Diretório de saída para arquivos processados (csv/json/plots/artifacts)")
    p.add_argument("--drop-cols", "-d", nargs="*", required=False, default=["A_id"],
                   help="Colunas a remover (por padrão ['A_id'])")
    p.add_argument("--label-col", "-l", required=False, default="Quality",
                   help="Nome da coluna de rótulo (default: Quality)")
    p.add_argument("--remove-outliers", action="store_true",
                   help="Se setado, remove linhas com outliers pelo método IQR")
    p.add_argument("--iqr-k", type=float, default=1.5,
                   help="Fator k para o IQR (default 1.5)")
    args = p.parse_args()
    main(args)

import json

result = {
    "status": "sucesso",
    "dados": [1, 2, 3]  # exemplo apenas
}
