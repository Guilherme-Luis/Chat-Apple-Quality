#!/usr/bin/env python3
"""
Preprocessing pipeline (mais robusto) para dataset de qualidade de maçãs.

Uso (exemplo):
python src/preprocess_pipeline.py \
  --input resources/apple_quality.csv \
  --out-dir resources \
  --drop-cols A_id \
  --remove-outliers

Outputs (padrão):
resources/processed_apple_quality.csv
resources/processed_apple_quality.json
resources/plots/correlation.png
resources/artifacts/pipeline_preprocessor.joblib
resources/artifacts/label_encoder.joblib
"""

import argparse
import json
import os
import logging
from typing import Optional, List, Tuple, Dict, Any

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler, OrdinalEncoder, LabelEncoder
import joblib

# Logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("preprocess_pipeline")

def ensure_dir(path: str):
    if not path:
        return
    os.makedirs(path, exist_ok=True)

def load_csv(path: str) -> pd.DataFrame:
    logger.info(f"Carregando CSV: {path}")
    df = pd.read_csv(path)
    logger.info(f"Shape inicial: {df.shape}")
    return df

def drop_columns(df: pd.DataFrame, cols: List[str]) -> pd.DataFrame:
    present = [c for c in cols if c in df.columns]
    if present:
        logger.info(f"Removendo colunas: {present}")
        return df.drop(columns=present)
    logger.info("Nenhuma coluna para remover.")
    return df

def report_missing(df: pd.DataFrame) -> pd.Series:
    miss = df.isnull().sum()
    miss = miss[miss > 0].sort_values(ascending=False)
    if not miss.empty:
        logger.info("Colunas com valores ausentes:\n" + miss.to_string())
    else:
        logger.info("Nenhum valor ausente encontrado.")
    return miss

def impute_basic(df: pd.DataFrame) -> pd.DataFrame:
    # Aplicado separadamente no pipeline também, mas mantemos uma versão "in place" para relatório inicial
    num_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    cat_cols = df.select_dtypes(include=['object', 'category']).columns.tolist()
    for c in num_cols:
        if df[c].isnull().any():
            med = df[c].median()
            df[c] = df[c].fillna(med)
            logger.info(f"Imputado {c} (num) com mediana={med}")
    for c in cat_cols:
        if df[c].isnull().any():
            mode = df[c].mode()
            fill = mode.iloc[0] if not mode.empty else "unknown"
            df[c] = df[c].fillna(fill)
            logger.info(f"Imputado {c} (cat) com moda='{fill}'")
    return df

def remove_duplicates(df: pd.DataFrame) -> Tuple[pd.DataFrame, int]:
    before = df.shape[0]
    df2 = df.drop_duplicates()
    removed = before - df2.shape[0]
    logger.info(f"Duplicatas removidas: {removed}")
    return df2, removed

def detect_outliers_iqr(df: pd.DataFrame, numeric_cols: List[str], k: float = 1.5) -> pd.Series:
    mask = pd.Series(False, index=df.index)
    for c in numeric_cols:
        q1 = df[c].quantile(0.25)
        q3 = df[c].quantile(0.75)
        iqr = q3 - q1
        lower = q1 - k * iqr
        upper = q3 + k * iqr
        col_mask = (df[c] < lower) | (df[c] > upper)
        mask |= col_mask
        logger.debug(f"{c}: outliers={col_mask.sum()}, limits=({lower:.3f},{upper:.3f})")
    logger.info(f"Linhas com outliers (qualquer coluna): {int(mask.sum())}")
    return mask

def compute_and_save_correlation_plot(df: pd.DataFrame, out_path: str):
    ensure_dir(os.path.dirname(out_path) or ".")
    num = df.select_dtypes(include=[np.number])
    if num.shape[1] < 2:
        logger.info("Não há colunas numéricas suficientes para plotar correlação.")
        return
    corr = num.corr()
    plt.figure(figsize=(10, 8))
    sns.heatmap(corr, annot=True, fmt=".2f", cmap="coolwarm", square=True)
    plt.title("Correlation matrix")
    plt.tight_layout()
    plt.savefig(out_path)
    plt.close()
    logger.info(f"Salvo plot de correlação em: {out_path}")

def encode_label(df: pd.DataFrame, label_col: str = "Quality") -> Tuple[pd.DataFrame, Any]:
    if label_col not in df.columns:
        raise ValueError(f"Label column '{label_col}' not in dataframe.")
    labels = df[label_col].dropna().unique().tolist()
    lowered = [str(x).lower() for x in labels]
    if set(lowered) == {"good", "bad"}:
        mapping = {"good": 1, "bad": 0}
        df[label_col + "_encoded"] = df[label_col].astype(str).str.lower().map(mapping)
        encoder = mapping
        logger.info("Usado mapping {'good':1,'bad':0} para codificação.")
    else:
        le = LabelEncoder()
        df[label_col + "_encoded"] = le.fit_transform(df[label_col].astype(str))
        encoder = le
        logger.info(f"LabelEncoder usado. Classes: {list(le.classes_)}")
    return df, encoder

def build_preprocessor(df: pd.DataFrame, exclude_label_col: Optional[str] = None) -> Tuple[ColumnTransformer, List[str]]:
    # Detecta colunas numéricas e categóricas automaticamente (após remoção da label)
    num_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    if exclude_label_col and exclude_label_col in num_cols:
        num_cols = [c for c in num_cols if c != exclude_label_col]
    cat_cols = df.select_dtypes(include=['object', 'category']).columns.tolist()

    # Imputer + scaler para numéricos, imputer + ord encoder para categóricos (se existirem)
    transformers = []
    if num_cols:
        num_pipeline = Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler())
        ])
        transformers.append(("num", num_pipeline, num_cols))

    if cat_cols:
        cat_pipeline = Pipeline([
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("ord_enc", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1))
        ])
        transformers.append(("cat", cat_pipeline, cat_cols))

    preprocessor = ColumnTransformer(transformers=transformers, remainder="drop", sparse_threshold=0)
    logger.info(f"Preprocessor built. Num cols: {num_cols}, Cat cols: {cat_cols}")
    return preprocessor, num_cols + cat_cols

def save_artifacts(out_dir: str, preprocessor: ColumnTransformer, label_encoder: Any):
    artifacts_dir = os.path.join(out_dir, "artifacts")
    ensure_dir(artifacts_dir)
    preprocessor_path = os.path.join(artifacts_dir, "pipeline_preprocessor.joblib")
    label_path = os.path.join(artifacts_dir, "label_encoder.joblib")
    joblib.dump(preprocessor, preprocessor_path)
    joblib.dump(label_encoder, label_path)
    logger.info(f"Preprocessor salvo: {preprocessor_path}")
    logger.info(f"Label encoder salvo: {label_path}")
    return artifacts_dir

def save_processed(df: pd.DataFrame, out_dir: str, base_name: str = "processed_apple_quality"):
    ensure_dir(out_dir)
    csv_path = os.path.join(out_dir, f"{base_name}.csv")
    json_path = os.path.join(out_dir, f"{base_name}.json")
    df.to_csv(csv_path, index=False)
    df.to_json(json_path, orient="records", force_ascii=False)
    logger.info(f"CSV salvo: {csv_path}")
    logger.info(f"JSON salvo: {json_path}")
    return csv_path, json_path

def main(args):
    df = load_csv(args.input)
    # Step 1: drop cols
    if args.drop_cols:
        df = drop_columns(df, args.drop_cols)

    # Step 2: report & impute (quick)
    report_missing(df)
    df = impute_basic(df)

    # Step 3: duplicates
    df, removed_dup = remove_duplicates(df)

    # Step 4: outliers (opcional)
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    if args.remove_outliers and numeric_cols:
        mask = detect_outliers_iqr(df, numeric_cols, k=args.iqr_k)
        before = df.shape[0]
        df = df.loc[~mask].copy()
        logger.info(f"Removed {before - df.shape[0]} rows by IQR outliers (k={args.iqr_k})")
    else:
        logger.info("Remoção de outliers não solicitada/sem colunas numéricas.")

    # Step 5: correlation plot
    plots_dir = os.path.join(args.out_dir, "plots")
    corr_path = os.path.join(plots_dir, "correlation.png")
    compute_and_save_correlation_plot(df, corr_path)

    # Step 6: encode label
    df, label_encoder = encode_label(df, label_col=args.label_col)

    # Step 7: build preprocessor excluding label encoded
    exclude_label = args.label_col + "_encoded"
    preprocessor, feature_cols = build_preprocessor(df.drop(columns=[args.label_col]), exclude_label_col=exclude_label)

    # Fit preprocessor on features (we pass df without original label but keeping encoded label removed)
    # Create X (features) from df dropping both original label and encoded label
    X_raw = df.drop(columns=[args.label_col, exclude_label], errors='ignore')
    # Fit preprocessor on X_raw
    if hasattr(preprocessor, "fit"):
        preprocessor.fit(X_raw)
        logger.info("Preprocessor fit concluído.")

    # Apply transform to get numeric array and create DataFrame of transformed features with names
    X_transformed = preprocessor.transform(X_raw)
    # Feature names: ColumnTransformer doesn't provide straightforward names, we can reconstruct
    # We'll just create generic names based on the order in feature_cols
    transformed_cols = []
    # NOTE: For numeric cols scaled, names preserved; for categorical OrdinalEncoder also mapped to single column each.
    transformed_cols = feature_cols  # matches the columns we passed to ColumnTransformer
    df_transformed = pd.DataFrame(X_transformed, columns=transformed_cols, index=df.index)

    # Reattach label encoded
    df_final = df_transformed.copy()
    df_final[exclude_label] = df[exclude_label].values

    # Save processed files and artifacts
    out_data_dir = args.out_dir
    csv_out, json_out = save_processed(df_final, out_data_dir, base_name=args.out_basename)
    artifacts_dir = save_artifacts(out_data_dir, preprocessor, label_encoder)

    # Save plots dir ensured
    ensure_dir(plots_dir)

    # Print summary JSON for integration
    summary = {
        "status": "success",
        "rows_total": int(df_final.shape[0]),
        "columns": df_final.columns.tolist(),
        "processed_csv": csv_out,
        "processed_json": json_out,
        "plots": corr_path,
        "artifacts_dir": artifacts_dir
    }
    print(json.dumps(summary, ensure_ascii=False))
    logger.info("Pré-processamento finalizado.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Preprocessing pipeline robusta")
    parser.add_argument("--input", "-i", required=False, default="resources/apple_quality.csv",
                        help="CSV de entrada (default: resources/apple_quality.csv)")
    parser.add_argument("--out-dir", "-o", required=False, default="resources",
                        help="Diretório de saída (default: resources)")
    parser.add_argument("--drop-cols", "-d", nargs="*", default=["A_id"],
                        help="Colunas a remover (default: ['A_id'])")
    parser.add_argument("--label-col", "-l", default="Quality",
                        help="Nome da coluna label (default: Quality)")
    parser.add_argument("--out-basename", default="processed_apple_quality",
                        help="Base name para arquivos de saída (default: processed_apple_quality)")
    parser.add_argument("--remove-outliers", action="store_true",
                        help="Remover outliers por IQR")
    parser.add_argument("--iqr-k", type=float, default=1.5,
                        help="Fator k para IQR (default:1.5)")
    args = parser.parse_args()
    main(args)
