import org.springframework.web.bind.annotation.*;

@RestController
public class BackupController {
    @PostMapping("/backup")
    public String backup(@RequestParam String nombre) throws Exception {
        new ProcessBuilder("sh", "-c", "tar -czf /backups/" + nombre + ".tgz /data").start().waitFor();
        return "ok";
    }
}
