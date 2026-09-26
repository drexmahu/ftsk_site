"""
Simple Tkinter GUI for membership_image_converter.py - no terminal typing
required. Run via run_gui.bat, or `py gui.py` / `python gui.py`.
"""

import queue
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, scrolledtext, ttk
from PIL import Image, ImageDraw, ImageTk

from membership_image_converter import DEFAULT_OUTPUT_FOLDER, process_folder


class CropSelection:
    def __init__(self, width, height):
        self.width = width
        self.height = height
        self.center_x = width / 2
        self.center_y = height / 2
        self.set_size(65)

    def set_size(self, percent):
        limit = min(self.width, self.height)
        self.side = max(min(32, limit), min(limit, round(limit * percent / 100)))
        self.move(self.center_x, self.center_y)

    def move(self, center_x, center_y):
        radius = self.side / 2
        self.center_x = max(radius, min(self.width - radius, center_x))
        self.center_y = max(radius, min(self.height - radius, center_y))

    def box(self):
        left = max(0, min(self.width - self.side, round(self.center_x - self.side / 2)))
        top = max(0, min(self.height - self.side, round(self.center_y - self.side / 2)))
        return left, top, left + self.side, top + self.side


class ManualCropDialog(tk.Toplevel):
    def __init__(self, parent, source_path, image):
        super().__init__(parent)
        self.title("Choose face crop")
        self.transient(parent)
        self.image = image.convert("RGB")
        self.selection = CropSelection(*self.image.size)
        self.result = None
        self.drag_offset = (0, 0)
        self.scale_x = self.scale_y = 1
        self.offset_x = self.offset_y = 0
        self.preview_image = None
        self.geometry(f"{min(960, parent.winfo_screenwidth() - 80)}x{min(720, parent.winfo_screenheight() - 100)}")
        self.minsize(560, 440)
        self.columnconfigure(0, weight=1)
        self.rowconfigure(1, weight=1)

        header = ttk.Frame(self, padding=(16, 12))
        header.grid(row=0, column=0, columnspan=2, sticky="ew")
        ttk.Label(header, text=source_path.name, font=("Segoe UI", 11, "bold"), wraplength=700).pack(anchor="w")
        ttk.Label(header, text="Face closeup", foreground="#666666").pack(anchor="w", pady=(4, 0))

        self.canvas = tk.Canvas(self, background="#202629", highlightthickness=0, cursor="hand2", takefocus=True)
        self.canvas.grid(row=1, column=0, sticky="nsew", padx=(16, 12))
        preview = ttk.Frame(self, padding=(0, 0, 16, 0))
        preview.grid(row=1, column=1, sticky="n")
        ttk.Label(preview, text="Avatar preview").pack(pady=(0, 8))
        self.avatar = tk.Canvas(preview, width=160, height=160, background="#202629", highlightthickness=0)
        self.avatar.pack()

        footer = ttk.Frame(self, padding=16)
        footer.grid(row=2, column=0, columnspan=2, sticky="ew")
        footer.columnconfigure(1, weight=1)
        ttk.Label(footer, text="Crop size").grid(row=0, column=0, padx=(0, 12))
        self.size_var = tk.DoubleVar(value=65)
        self.size_scale = ttk.Scale(footer, from_=5, to=100, variable=self.size_var, command=self._resize_crop)
        self.size_scale.grid(row=0, column=1, sticky="ew")
        self.size_label = ttk.Label(footer, width=5, anchor="e")
        self.size_label.grid(row=0, column=2, padx=(8, 0))
        buttons = ttk.Frame(footer)
        buttons.grid(row=1, column=0, columnspan=3, sticky="e", pady=(14, 0))
        ttk.Button(buttons, text="Reset", command=self._reset).pack(side="left", padx=(0, 8))
        ttk.Button(buttons, text="Skip photo", command=self.destroy).pack(side="left", padx=(0, 8))
        ttk.Button(buttons, text="Use crop", command=self._accept).pack(side="left")

        self.canvas.bind("<Configure>", self._render)
        self.canvas.bind("<Button-1>", self._press)
        self.canvas.bind("<B1-Motion>", self._drag)
        self.canvas.bind("<MouseWheel>", self._wheel)
        self.canvas.bind("<Left>", lambda event: self._nudge(-1, 0, event))
        self.canvas.bind("<Right>", lambda event: self._nudge(1, 0, event))
        self.canvas.bind("<Up>", lambda event: self._nudge(0, -1, event))
        self.canvas.bind("<Down>", lambda event: self._nudge(0, 1, event))
        self.bind("<Return>", lambda event: self._accept())
        self.bind("<Escape>", lambda event: self.destroy())
        self.protocol("WM_DELETE_WINDOW", self.destroy)
        self.grab_set()
        self.after_idle(self.canvas.focus_set)

    def _point(self, event):
        return (event.x - self.offset_x) / self.scale_x, (event.y - self.offset_y) / self.scale_y

    def _press(self, event):
        self.canvas.focus_set()
        source_x, source_y = self._point(event)
        delta_x = source_x - self.selection.center_x
        delta_y = source_y - self.selection.center_y
        self.drag_offset = (delta_x, delta_y) if delta_x ** 2 + delta_y ** 2 <= (self.selection.side / 2) ** 2 else (0, 0)
        self._drag(event)

    def _drag(self, event):
        source_x, source_y = self._point(event)
        self.selection.move(source_x - self.drag_offset[0], source_y - self.drag_offset[1])
        self._render()

    def _resize_crop(self, value):
        self.selection.set_size(float(value))
        self._render()

    def _wheel(self, event):
        self.size_var.set(max(5, min(100, self.size_var.get() + (3 if event.delta > 0 else -3))))
        self._resize_crop(self.size_var.get())
        return "break"

    def _nudge(self, horizontal, vertical, event):
        step = max(1, self.selection.side / 100) * (5 if event.state & 1 else 1)
        self.selection.move(self.selection.center_x + horizontal * step, self.selection.center_y + vertical * step)
        self._render()
        return "break"

    def _reset(self):
        self.selection = CropSelection(*self.image.size)
        self.size_var.set(65)
        self._render()

    def _accept(self):
        self.result = self.selection.box()
        self.destroy()

    def _render(self, event=None):
        if self.canvas.winfo_width() < 32 or self.canvas.winfo_height() < 32:
            return
        width = max(1, self.canvas.winfo_width() - 24)
        height = max(1, self.canvas.winfo_height() - 24)
        scale = min(width / self.image.width, height / self.image.height)
        size = max(1, round(self.image.width * scale)), max(1, round(self.image.height * scale))
        if self.preview_image is None or self.preview_image.size != size:
            self.preview_image = self.image.resize(size, Image.Resampling.LANCZOS)
        self.scale_x = size[0] / self.image.width
        self.scale_y = size[1] / self.image.height
        self.offset_x = (self.canvas.winfo_width() - size[0]) / 2
        self.offset_y = (self.canvas.winfo_height() - size[1]) / 2
        left, top, right, bottom = self.selection.box()
        circle = left * self.scale_x, top * self.scale_y, right * self.scale_x, bottom * self.scale_y
        shade = Image.new("RGBA", size, (0, 0, 0, 155))
        ImageDraw.Draw(shade).ellipse(circle, fill=(0, 0, 0, 0))
        self.display_photo = ImageTk.PhotoImage(Image.alpha_composite(self.preview_image.convert("RGBA"), shade), master=self.canvas)
        self.canvas.delete("all")
        self.canvas.create_image(self.offset_x, self.offset_y, image=self.display_photo, anchor="nw")
        self.canvas.create_oval(circle[0] + self.offset_x, circle[1] + self.offset_y, circle[2] + self.offset_x, circle[3] + self.offset_y, outline="#e2bb72", width=3)
        portrait = self.preview_image.crop(tuple(round(value) for value in circle)).resize((160, 160), Image.Resampling.LANCZOS)
        avatar = Image.new("RGB", (160, 160), "#202629")
        mask = Image.new("L", (160, 160), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, 159, 159), fill=255)
        avatar.paste(portrait, (0, 0), mask)
        self.avatar_photo = ImageTk.PhotoImage(avatar, master=self.avatar)
        self.avatar.delete("all")
        self.avatar.create_image(0, 0, image=self.avatar_photo, anchor="nw")
        self.size_label.configure(text=f"{round(self.size_var.get())}%")


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Member Image Web Optimizer")
        self.minsize(560, 480)
        self.running = False
        self.closing = False
        self.events = queue.Queue()

        self.input_var = tk.StringVar(value="./members-source")
        self.output_var = tk.StringVar(value=str(DEFAULT_OUTPUT_FOLDER))
        self.thumb_size_var = tk.IntVar(value=400)
        self.full_width_var = tk.IntVar(value=1400)
        self.full_height_var = tk.IntVar(value=1400)
        self.quality_var = tk.IntVar(value=85)
        self.status_var = tk.StringVar(value="Ready.")

        self._build_layout()
        self.protocol("WM_DELETE_WINDOW", self._close)
        self.after(50, self._drain_events)

    def _close(self):
        if self.running and not messagebox.askyesno("Close converter?", "Stop processing and close the converter?", parent=self):
            return
        self.closing = True
        self.destroy()

    def _drain_events(self):
        if self.closing:
            return
        try:
            while True:
                kind, payload = self.events.get_nowait()
                if kind == "log":
                    self._log(payload)
                elif kind == "progress":
                    self.status_var.set(payload)
                elif kind == "finish":
                    self._finish(payload)
                elif kind == "crop":
                    try:
                        self.status_var.set(f"Choose face crop: {payload['path'].name}")
                        dialog = ManualCropDialog(self, payload["path"], payload["image"])
                        self.wait_window(dialog)
                        payload["box"] = dialog.result
                    except tk.TclError:
                        payload["box"] = None
                    finally:
                        payload["ready"].set()
                    if self.closing:
                        return
        except queue.Empty:
            pass
        if not self.closing:
            self.after(50, self._drain_events)

    def _manual_crop(self, source_path, image):
        request = {"path": source_path, "image": image, "box": None, "ready": threading.Event()}
        if self.closing:
            return None
        self.events.put(("crop", request))
        while not request["ready"].wait(0.1):
            if self.closing:
                return None
        return request["box"]

    def _build_layout(self):
        pad = {"padx": 8, "pady": 6}

        folders = ttk.Frame(self)
        folders.pack(fill="x", **pad)
        self._folder_row(folders, "Input folder (original photos):", self.input_var, self._browse_input)
        self._folder_row(folders, "Output folder (converted photos):", self.output_var, self._browse_output)

        settings = ttk.LabelFrame(self, text="Settings")
        settings.pack(fill="x", **pad)

        self._number_row(settings, 0, "Thumbnail size (px):", self.thumb_size_var)
        self._number_row(settings, 1, "Max full-image width (px):", self.full_width_var)
        self._number_row(settings, 2, "Max full-image height (px):", self.full_height_var)
        self._number_row(settings, 3, "WebP quality (1-100):", self.quality_var)

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
        chosen = filedialog.askdirectory(title="Select the folder with original member photos")
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
            thumb_size = self.thumb_size_var.get()
            full_width = self.full_width_var.get()
            full_height = self.full_height_var.get()
            quality = self.quality_var.get()
        except tk.TclError:
            messagebox.showerror("Invalid setting", "Thumbnail size, width, height and quality must be whole numbers.")
            return

        if not (1 <= quality <= 100):
            messagebox.showerror("Invalid setting", "WebP quality must be between 1 and 100.")
            return
        if min(thumb_size, full_width, full_height) <= 0:
            messagebox.showerror("Invalid setting", "Image dimensions must be positive whole numbers.")
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
            args=(
                input_folder,
                output_folder,
                thumb_size,
                full_width,
                full_height,
                quality,
            ),
            daemon=True,
        )
        thread.start()

    def _run_job(self, input_folder, output_folder, thumb_size, full_width, full_height, quality):
        def log(message):
            self.events.put(("log", message))

        def progress(index, total, filename):
            self.events.put(("progress", f"Processing {index} of {total}: {filename}"))

        try:
            processed, failed, images = process_folder(
                input_folder,
                output_folder,
                thumb_size,
                full_width,
                full_height,
                quality,
                log=log,
                on_progress=progress,
                manual_crop=self._manual_crop,
            )
        except (FileNotFoundError, RuntimeError) as exc:
            self.events.put(("finish", str(exc)))
            return
        except Exception as exc:
            self.events.put(("finish", f"Unexpected error: {exc}"))
            return

        if not images:
            self.events.put(("finish", "No supported images found in that input folder."))
            return

        summary = f"Done - processed {processed} of {len(images)} image(s)"
        if failed:
            summary += f", {failed} skipped or failed"
        summary += f". Output: {Path(output_folder).expanduser().resolve()}"
        self.events.put(("finish", summary))

    def _finish(self, status_message):
        self.status_var.set(status_message)
        self.start_button.configure(state="normal")
        self.running = False


if __name__ == "__main__":
    App().mainloop()
