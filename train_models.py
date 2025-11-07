#!/usr/bin/env python3
"""
train_models.py

Treina os classificadores solicitados e salva modelos/metrics.

Uso:
python train_models.py --processed-csv resources/processed_apple_quality.csv --artifacts-dir resources/artifacts_models --cv 5
"""
import argparse
import json
import os

import joblib
import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.linear_model import LogisticRegression
from sklearn.discriminant_analysis import LinearDiscriminantAnalysis
from sklearn.neighbors import KNeighborsClassifier
from sklearn.tree import DecisionTreeClassifier
from sklearn.naive_bayes import GaussianNB
from sklearn.svm import SVC

CLASSIFIERS = {
    "logistic_regression": LogisticRegression(max_iter=1000, solver="liblinear", random_state=42),
    "lda": LinearDiscriminantAnalysis(),
    "knn": KNeighborsClassifier(),
    "decision_tree": DecisionTreeClassifier(random_state=42),
    "gaussian_nb": GaussianNB(),
    "svm": SVC(probability=True, random_state=42)
}

def ensure_dir(path):
    if not path:
        return
    os.makedirs(path, exist_ok=True)

def load_data(processed_csv, label_col="Quality_encoded"):
    df = pd.read_csv(processed_csv)
    if label_col not in df.columns:
        raise ValueError(f"Label column '{label_col}' not found in processed CSV.")
    X = df.drop(columns=[label_col])
    y = df[label_col].values
    # se X possuir colunas não numéricas, faz get_dummies
    if not all(dtype.kind in 'iu f' for dtype in X.dtypes):
        X = pd.get_dummies(X)
    return X.values, y, list(pd.DataFrame(X).columns)

def evaluate_classifier(clf, X, y, cv=5):
    skf = StratifiedKFold(n_splits=cv, shuffle=True, random_state=42)
    acc = cross_val_score(clf, X, y, cv=skf, scoring="accuracy")
    f1 = cross_val_score(clf, X, y, cv=skf, scoring="f1_weighted")
    return {
        "accuracy_mean": float(acc.mean()),
        "accuracy_std": float(acc.std()),
        "f1_mean": float(f1.mean()),
        "f1_std": float(f1.std())
    }

def main(args):
    processed_csv = args.processed_csv
    artifacts_dir = args.artifacts_dir
    ensure_dir(artifacts_dir)

    X, y, feature_names = load_data(processed_csv, label_col=args.label_col)
    results = {}
    best_score = -1.0
    best_name = None

    for name, clf in CLASSIFIERS.items():
        print(f"[+] Avaliando {name} ...")
        metrics = evaluate_classifier(clf, X, y, cv=args.cv)
        results[name] = metrics
        print(f"    accuracy={metrics['accuracy_mean']:.4f} f1={metrics['f1_mean']:.4f}")

        # treina no dataset completo e salva
        clf.fit(X, y)
        model_path = os.path.join(artifacts_dir, f"{name}.joblib")
        joblib.dump({"model": clf, "features": feature_names}, model_path)
        print(f"    modelo salvo em: {model_path}")

        if metrics["accuracy_mean"] > best_score:
            best_score = metrics["accuracy_mean"]
            best_name = name

    # salva melhor modelo como best_model.joblib
    if best_name:
        best_src = os.path.join(artifacts_dir, f"{best_name}.joblib")
        best_dst = os.path.join(artifacts_dir, "best_model.joblib")
        joblib.dump(joblib.load(best_src), best_dst)
        print(f"[+] Melhor modelo: {best_name} (accuracy_mean={best_score:.4f}). Salvo em {best_dst}")

    # salva metrics
    metrics_out = os.path.join(artifacts_dir, "model_metrics.json")
    summary = {"models": results, "best_model": {"name": best_name, "accuracy_mean": best_score}}
    with open(metrics_out, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(f"[+] Métricas salvas em {metrics_out}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--processed-csv", "-i", default="resources/processed_apple_quality.csv")
    parser.add_argument("--artifacts-dir", "-a", default="resources/artifacts_models")
    parser.add_argument("--label-col", "-l", default="Quality_encoded")
    parser.add_argument("--cv", type=int, default=5)
    args = parser.parse_args()
    main(args)
