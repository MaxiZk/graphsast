import java.nio.file.*;
import org.springframework.web.bind.annotation.*;

@RestController
public class PlantillaController {
    @GetMapping("/plantillas/{nombre}")
    public String leer(@PathVariable String nombre) throws Exception {
        return Files.readString(Paths.get("plantillas", nombre));
    }
}
