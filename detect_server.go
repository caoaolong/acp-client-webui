package main

import (
	"os"
	"path/filepath"
	"strings"
)

func detectServerExecutable(serverType string) (string, error) {
	var commands []string
	switch serverType {
	case "qwen":
		if isWindows() {
			commands = []string{"qwen.exe", "qwen.cmd", "qwen"}
		} else {
			commands = []string{"qwen"}
		}
	case "opencode":
		if isWindows() {
			commands = []string{"opencode.exe", "opencode.cmd", "opencode"}
		} else {
			commands = []string{"opencode"}
		}
	case "cursor":
		if isWindows() {
			commands = []string{"Cursor.exe", "cursor.exe", "cursor"}
		} else {
			commands = []string{"cursor"}
		}
	case "custom":
		return "", nil
	default:
		return "", nil
	}

	if path := searchPath(commands); path != "" {
		return path, nil
	}

	for _, path := range commonInstallPaths(serverType) {
		if fileExists(path) {
			return path, nil
		}
	}

	return "", nil
}

func isWindows() bool {
	return os.PathSeparator == '\\'
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func searchPath(commands []string) string {
	pathVar := os.Getenv("PATH")
	if pathVar == "" {
		return ""
	}
	separator := string(os.PathListSeparator)
	for _, dir := range strings.Split(pathVar, separator) {
		for _, cmd := range commands {
			path := filepath.Join(dir, cmd)
			if fileExists(path) {
				return path
			}
		}
	}
	return ""
}

func commonInstallPaths(serverType string) []string {
	home, _ := os.UserHomeDir()
	var paths []string

	switch serverType {
	case "cursor":
		if isWindows() {
			paths = append(paths,
				`C:\Program Files\Cursor\Cursor.exe`,
				`C:\Program Files (x86)\Cursor\Cursor.exe`,
				filepath.Join(home, "AppData/Local/Programs/cursor/Cursor.exe"),
				filepath.Join(home, "AppData/Local/cursor/Cursor.exe"),
			)
		}
	case "opencode":
		if isWindows() {
			paths = append(paths,
				filepath.Join(home, "AppData/Roaming/npm/opencode.cmd"),
				filepath.Join(home, "AppData/Roaming/npm/opencode.exe"),
				filepath.Join(home, "AppData/Local/npm/opencode.cmd"),
				filepath.Join(home, "AppData/Local/npm/opencode.exe"),
				`C:\Program Files\nodejs\opencode.cmd`,
				`C:\Program Files\nodejs\opencode.exe`,
			)
		} else {
			paths = append(paths,
				"/usr/local/bin/opencode",
				"/usr/bin/opencode",
				filepath.Join(home, ".local/bin/opencode"),
			)
		}
	}

	return paths
}
