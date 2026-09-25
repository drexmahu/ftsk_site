"""
Simple Tkinter GUI for site_image_converter.py - no terminal typing required.
Run via run_gui.bat, or `py gui.py` / `python gui.py`.
"""

import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, scrolledtext, ttk

from site_image_converter import DEFAULT_OUTPUT_FOLDER, process_folder


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Site Image Web Optimizer")
        self.minsize(560, 480)
        self.running = False

        self.input_var = tk.StringVar(value="./site-images-source")
        self.output_var = tk.StringVar(value=str(DEFAULT_OUTPUT_FOLDER))
        self.max_width_var = tk.IntVar(value=1600)
        self.max_height_var = tk.IntVar(value=1600)
        self.quality_var = tk.IntVar(value=82)
        self.status_var = tk.StringVar(value="Ready.")

        self._build_layout()

    def _build_layout(self):
        pad = {"padx": 8, "pady": 6}

        folders = ttk.Frame(self)
        folders.pack(fill="x", **pad)
        self._folder_row(folders, "Input folder (original photos):", self.input_var, self._browse_input)
        self._folder_row(folders, "Output folder (converted photos):", self.output_var, self._browse_output)

        settings = ttk.LabelFrame(self, text="Settings")
        settings.pack(fill="x", **pad)

        self._number_row(settings, 0, "Max output width (px):", self.max_width_var)
        self._number_row(settings, 1, "Max output height (px):", self.max_height_var)
        self._number_row(settings, 2, "WebP quality (1-100):", self.quality_var)
        settings.columnconfigure(1, weight=1)

        self.start_button = ttk.Button(self, text="Start", command=self._on_start)
        self.start_button.pack(pady=(4, 8))

        ttk.Label(self, textvariable=self.status_var).pack(fill="x", padx=8)

        self.log_box = scrolledtext.ScrolledText(self, height=16, state="disabled", font=("Consolas", 9))
        self.log_box.pack(fill="both", expand=True, padx=8, pady=8)

    def _folder_row(self, parent, label, var, browse_command):
        row = ttk.Frame(parent)
        row.pack(fill="x", pady=2)
        ttk.Label(row, text=label, width=30).pack(side="left")
        ttk.Entry(row, textvariable=var).pack(side="left", fill="x", expand=True, padx=(0, 6))
        ttk.Button(row, text="Browse...", command=browse_command).pack(side="left")

    def _number_row(self, parent, row, label, var):
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", padx=6, pady=4)
        ttk.Entry(parent, textvariable=var, width=10).grid(row=row, column=1, sticky="w", padx=6, pady=4)

    def _browse_input(self):
        chosen = filedialog.askdirectory(title="Select the folder with original photos")
        if chosen:
            self.input_var.set(chosen)

    def _browse_output(self):
        chosen = filedialog.askdirectory(title="Select (or create) the output folder")
        if chosen:
            self.output_var.set(chosen)

    def _log(self, message):
        self.log_box.configure(state="normal")
        self.log_box.insert("end", str(message) + "\n")
        self.log_box.see("end")
        self.log_box.configure(state="disabled")

    def _on_start(self):
        if self.running:
            return

        try:
            max_width = self.max_width_var.get()
            max_height = self.max_height_var.get()
            quality = self.quality_var.get()
        except tk.TclError:
            messagebox.showerror("Invalid setting", "Width, height and quality must be whole numbers.")
            return

        if not (1 <= quality <= 100):
            messagebox.showerror("Invalid setting", "WebP quality must be between 1 and 100.")
            return

        input_folder = self.input_var.get().strip()
        output_folder = self.output_var.get().strip()
        if not input_folder or not output_folder:
            messagebox.showerror("Missing folder", "Please choose both an input and an output folder.")
            return

        self.running = True
        self.start_button.configure(state="disabled")
        self.log_box.configure(state="normal")
        self.log_box.delete("1.0", "end")
        self.log_box.configure(state="disabled")
        self.status_var.set("Starting...")

        thread = threading.Thread(
            target=self._run_job,
            args=(input_folder, output_folder, max_width, max_height, quality),
            daemon=True,
        )
        thread.start()

    def _run_job(self, input_folder, output_folder, max_width, max_height, quality):
        def log(message):
            self.after(0, self._log, message)

        def progress(index, total, filename):
            self.after(0, self.status_var.set, f"Processing {index} of {total}: {filename}")

        try:
            processed, failed, images = process_folder(
                input_folder,
                output_folder,
                max_width,
                max_height,
                quality,
                log=log,
                on_progress=progress,
            )
        except FileNotFoundError as exc:
            self.after(0, self._finish, str(exc))
            return
        except Exception as exc:
            self.after(0, self._finish, f"Unexpected error: {exc}")
            return

        if not images:
            self.after(0, self._finish, "No supported images found in that input folder.")
            return

        summary = f"Done - processed {processed} of {len(images)} image(s)"
        if failed:
            summary += f", {failed} failed"
        summary += f". Output: {Path(output_folder).expanduser().resolve()}"
        self.after(0, self._finish, summary)

    def _finish(self, status_message):
        self.status_var.set(status_message)
        self.start_button.configure(state="normal")
        self.running = False


if __name__ == "__main__":
    App().mainloop()
